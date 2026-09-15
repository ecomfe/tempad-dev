<script setup lang="ts">
import type {
  DesignActionResult,
  DesignFeedback,
  DesignFeedbackItem,
  DesignTask,
  FeedbackDraftRequest,
  FeedbackDraftSnapshot
} from '@tempad-dev/shared'

import {
  DesignFeedbackItemSchema,
  DesignFeedbackSchema,
  MCP_DESIGN_FEEDBACK_MAX_ITEMS
} from '@tempad-dev/shared'
import { onClickOutside, unrefElement, useEventListener, useResizeObserver } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import Button from '@/components/Button.vue'
import IconButton from '@/components/IconButton.vue'
import ArrowUp from '@/components/icons/ArrowUp.vue'
import Check from '@/components/icons/Check.vue'
import Comment from '@/components/icons/Comment.vue'
import Spinner from '@/components/icons/Spinner.vue'
import Times from '@/components/icons/Times.vue'
import { useToast } from '@/composables/toast'
import {
  canvasClipStyle,
  canvasHoverContains,
  canvasRectsOverlap,
  observeCanvasOverlay,
  placeCanvasPopover,
  projectCanvasAnchor,
  selectionActionBounds,
  type CanvasOverlayFrame
} from '@/mcp/canvas-overlay'
import {
  describeFeedbackTarget,
  getFeedbackDraftScope,
  sameFeedbackItem
} from '@/mcp/design-feedback'
import { readFigmaSession } from '@/mcp/figma-session'
import { getContainingPage } from '@/mcp/local-resources'

const props = defineProps<{
  task: DesignTask
  canvasEnabled?: boolean
  actionResult?: DesignActionResult | null
  sessionId: string
  restored?: boolean
  sendFeedback?: (feedback: DesignFeedback) => Promise<DesignActionResult>
  requestDrafts?: (request: FeedbackDraftRequest) => Promise<FeedbackDraftSnapshot>
}>()
const { show: showError } = useToast()
const emit = defineEmits<{
  dismissBlocked: [blocked: boolean]
}>()

type Draft = { node: SceneNode | null; item: DesignFeedbackItem }
type Marker = {
  node: SceneNode
  nodeId: string
  number: number | null
  x: number
  y: number
  revealed: boolean
  occluded: boolean
}
type Editor = { key: string; node: SceneNode } & NonNullable<
  ReturnType<typeof describeFeedbackTarget>
>

// Drafts survive lease changes and reloads within this design task.
const drafts = shallowRef<Draft[]>([])
const scope = computed(() => getFeedbackDraftScope(props.task))
const scopeKey = computed(() => JSON.stringify(scope.value))
let attempt: DesignFeedback | undefined
const deliveries = new Map<string, DesignFeedback>()
let generation = 0
const editor = shallowRef<Editor | null>(null)
const editorText = shallowRef('')
const editedDraft = computed(() =>
  drafts.value.find((draft) => draft.item.nodeId === editor.value?.nodeId)
)
const editorHasChanges = computed(
  () => !!editor.value && editorText.value.trim() !== (editedDraft.value?.item.text ?? '')
)

const editorError = shallowRef('')
const editorWarned = shallowRef(false)
watch([editor, editorText], () => (editorWarned.value = false))
const editorElement = shallowRef<HTMLElement | null>(null)
const editorInput = shallowRef<HTMLTextAreaElement | null>(null)
watch(
  [editorInput, () => editor.value?.nodeId],
  ([input]) => input?.focus({ preventScroll: true }),
  {
    flush: 'post'
  }
)
const editorMultiline = shallowRef(false)
const editorHeight = shallowRef(220)
useResizeObserver(editorElement, () => {
  editorHeight.value = editorElement.value?.offsetHeight ?? 220
})
const batchOpen = shallowRef(false)
const batchButton = shallowRef<InstanceType<typeof Button> | null>(null)
const batchTrigger = computed(() => unrefElement(batchButton))
const batchElement = shallowRef<HTMLElement | null>(null)
const commentInput = shallowRef<HTMLTextAreaElement | null>(null)
const commentMultiline = shallowRef(false)
let focusBatch = false
function toggleBatch(): void {
  if (!commentsEnabled.value || sending.value) return
  if (editor.value && !dismissEditor()) return
  focusBatch = !batchOpen.value
  batchOpen.value = !batchOpen.value
}
function closeBatch(): void {
  batchOpen.value = false
  focusBatch = false
  batchTrigger.value?.focus({ preventScroll: true })
}
watch(commentInput, (element) => {
  if (element && focusBatch) {
    element.focus({ preventScroll: true })
    focusBatch = false
  }
})
const batchHeight = shallowRef(320)
useResizeObserver(batchElement, () => {
  batchHeight.value = batchElement.value?.offsetHeight ?? 320
})
onClickOutside(batchElement, () => (batchOpen.value = false), { ignore: [batchTrigger] })

const commentText = shallowRef('')
const savedComment = shallowRef('')
const commentSaving = shallowRef(false)
const commentError = shallowRef('')
let commentTimer: ReturnType<typeof setTimeout> | undefined
let pendingComment: Promise<boolean> | undefined

// These flags belong to the current scope; generation guards reject callbacks after a reset.
const sending = shallowRef(false)
const submitting = shallowRef<'editor' | 'batch' | null>(null)
const queuedFeedbackId = shallowRef<string | null>(null)
const fading = shallowRef(false)
const fadingNodes = shallowRef<ReadonlySet<string>>(new Set())
let deliveredItems: DesignFeedbackItem[] = []
const persisting = shallowRef(false)
const loading = shallowRef(false)
const clearing = shallowRef(false)
const ready = shallowRef(false)
const deliveryPending = computed(() => sending.value || !!queuedFeedbackId.value)
const draftsBusy = computed(
  () => deliveryPending.value || fading.value || persisting.value || loading.value || clearing.value
)
const busy = computed(() => draftsBusy.value || commentSaving.value)
const metaPressed = shallowRef(false)
useEventListener(window, 'keydown', (event) => (metaPressed.value = event.metaKey), {
  capture: true
})
useEventListener(window, 'keyup', (event) => (metaPressed.value = event.metaKey), { capture: true })
const suppressedNode = shallowRef<string | null>(null)
let selectedNodeId: string | null = null
const hoveredMarker = shallowRef<string | null>(null)
let hideAddAt: number | undefined
let pointer: { x: number; y: number } | null = null
useEventListener(
  window,
  'pointermove',
  (event) => {
    pointer = { x: event.clientX, y: event.clientY }
  },
  { passive: true, capture: true }
)
useEventListener(window, 'pointerout', (event) => {
  if (!event.relatedTarget) pointer = null
})
let clearTimer: ReturnType<typeof setTimeout> | undefined

const local = computed(() => props.restored || props.task.target.sessionId === props.sessionId)
const commentsEnabled = computed(
  () =>
    local.value &&
    props.canvasEnabled !== false &&
    !['stopping', 'cancelled'].includes(props.task.status)
)
const canDraft = computed(() => commentsEnabled.value && !!scope.value && !!props.requestDrafts)

useEventListener(window, 'blur', () => {
  metaPressed.value = false
  pointer = null
  hoveredMarker.value = null
})
const hasContent = computed(() => drafts.value.length > 0 || !!commentText.value.trim())
const submissionBlockedHint = computed(() => {
  if (!canDraft.value) return 'Comments unavailable.'
  if (!ready.value) return 'Loading comments…'
  if (editorHasChanges.value) return 'Save the element comment first.'
  if (draftsBusy.value) return 'Comments are updating…'
  if (!hasContent.value) return 'Add a comment first.'
  return ''
})
const batchMode = computed(() => (metaPressed.value && hasContent.value ? 'steer' : 'queue'))
const hasEditorContent = computed(() => !!editorText.value.trim())
const editorMode = computed(() => (metaPressed.value && hasEditorContent.value ? 'steer' : 'queue'))
const requestError = shallowRef('')
watch(
  [editorError, commentError, requestError],
  (messages, previous) => {
    // The same failure may reach both the request promise and its delivery receipt.
    const message = messages.find((message) => message && !previous.includes(message))
    if (message) showError(message)
  },
  { flush: 'sync' }
)
const triggerHint = computed(() => {
  if (sending.value) return 'Sending comments…'
  if (queuedFeedbackId.value)
    return `Comments queued. Waiting for ${props.task.client?.name || 'the agent'}…`
  if (!canDraft.value) return 'Comments unavailable.'
  return 'Review comments'
})

async function saveComment(): Promise<boolean> {
  clearTimeout(commentTimer)
  if (pendingComment) {
    if (!(await pendingComment)) return false
    return saveComment()
  }
  const draftScope = scope.value
  const comment = commentText.value.trim()
  if (comment === savedComment.value) return true
  if (!draftScope || !props.requestDrafts || busy.value) {
    showError(busy.value ? 'Comments are updating…' : 'Could not save the comment.')
    return false
  }
  const token = generation
  commentSaving.value = true
  commentError.value = ''
  requestError.value = ''
  const request = props
    .requestDrafts({ operation: 'comment', scope: draftScope, comment })
    .then((snapshot) => {
      if (token !== generation) return false
      installSnapshot(snapshot)
      commentError.value = ''
      requestError.value = ''
      return true
    })
    .catch((error) => {
      if (token === generation) {
        commentError.value = error instanceof Error ? error.message : 'Could not save the comment.'
        requestError.value = commentError.value
      }
      return false
    })
    .finally(() => {
      if (token === generation) {
        commentSaving.value = false
        pendingComment = undefined
      }
    })
  pendingComment = request
  if (!(await request)) return false
  return saveComment()
}
async function prepareDismiss(discard: boolean, close?: () => Promise<void>): Promise<boolean> {
  if (!discard) {
    if (editorHasChanges.value && editorText.value.trim()) {
      await saveDraft()
      if (editorHasChanges.value) {
        requestError.value = editorError.value || 'Could not save the comment.'
        return false
      }
    }
    return saveComment()
  }
  const draftScope = scope.value
  if (!draftScope || !props.requestDrafts) {
    await close?.()
    return true
  }
  const token = generation
  clearTimeout(commentTimer)
  clearing.value = true
  requestError.value = ''
  try {
    // A save already sent to storage must settle before deleting the round.
    await pendingComment
    if (token !== generation) return false
    const snapshot = close
      ? (await close(), { items: [] })
      : await props.requestDrafts({ operation: 'clear', scope: draftScope })
    if (token !== generation) return false
    installSnapshot(snapshot)
    commentText.value = ''
    commentError.value = ''
    deliveries.clear()
    editor.value = null
    requestError.value = ''
    return true
  } catch (error) {
    if (token === generation)
      requestError.value = error instanceof Error ? error.message : 'Could not clear comments.'
    return false
  } finally {
    if (token === generation) clearing.value = false
  }
}
defineExpose({ prepareDismiss })

watch([commentText, busy], () => {
  clearTimeout(commentTimer)
  if (!busy.value && !commentError.value && commentText.value.trim() !== savedComment.value)
    commentTimer = setTimeout(() => void saveComment(), 400)
})

async function hydrateNodes(): Promise<void> {
  const draftScope = scope.value
  if (!draftScope || readFigmaSession(props.sessionId, false)?.fileKey !== draftScope.fileKey)
    return
  const token = generation
  const values = drafts.value
  const next = await Promise.all(
    values.map(async (draft): Promise<Draft> => {
      if (draft.node && !draft.node.removed) return draft
      try {
        const node = await window.figma.getNodeByIdAsync(draft.item.nodeId)
        return {
          ...draft,
          node: node && node.type !== 'PAGE' && node.type !== 'DOCUMENT' ? node : null
        }
      } catch {
        return { ...draft, node: null }
      }
    })
  )
  if (
    token === generation &&
    drafts.value === values &&
    readFigmaSession(props.sessionId, false)?.fileKey === draftScope.fileKey
  )
    drafts.value = next
}

function installSnapshot(snapshot: FeedbackDraftSnapshot, knownNode?: SceneNode): void {
  const previous = drafts.value
  const previousComment = savedComment.value
  savedComment.value = snapshot.comment ?? ''
  if (commentText.value.trim() === previousComment) commentText.value = savedComment.value
  ready.value = true
  drafts.value = snapshot.items.map((item) => ({
    item,
    node:
      knownNode?.id === item.nodeId
        ? knownNode
        : (previous.find((draft) => draft.item.nodeId === item.nodeId)?.node ?? null)
  }))
  if (snapshot.submission) {
    const feedback = snapshot.submission
    deliveries.set(feedback.id, feedback)
    attempt = feedback
  } else attempt = undefined
  void hydrateNodes()
}

let loadRetryTimer: ReturnType<typeof setTimeout> | undefined
let loadRetryDelay = 1000

async function loadDrafts(): Promise<void> {
  const draftScope = scope.value
  if (
    !draftScope ||
    !local.value ||
    !props.requestDrafts ||
    busy.value ||
    ['stopping', 'cancelled'].includes(props.task.status)
  )
    return
  clearTimeout(loadRetryTimer)
  const token = generation
  const key = scopeKey.value
  loading.value = true
  requestError.value = ''
  ready.value = false
  try {
    const snapshot = await props.requestDrafts({ operation: 'load', scope: draftScope })
    if (token !== generation) return
    installSnapshot(snapshot)
    loadRetryDelay = 1000
    if (scopeKey.value === key) {
      requestError.value = snapshot.submission ? 'Sending not confirmed.' : ''
    }
  } catch {
    if (token === generation) {
      // The bridge reconnects independently; wait for it without exposing repair controls.
      loadRetryTimer = setTimeout(() => void loadDrafts(), loadRetryDelay)
      loadRetryDelay = Math.min(loadRetryDelay * 2, 10000)
    }
  } finally {
    if (token === generation) loading.value = false
  }
}

function visibleNodePage(node: SceneNode): string | null {
  if (node.removed) return null
  let page: BaseNode | null = node
  while (page && page.type !== 'PAGE') {
    if ('visible' in page && !page.visible) return null
    page = page.parent
  }
  return page?.id ?? null
}

function openEditor(marker: Pick<Marker, 'node' | 'nodeId'>): void {
  if (!commentsEnabled.value || busy.value || submitting.value) return
  const target = describeFeedbackTarget(marker.node)
  if (!target) return
  if (editor.value?.nodeId === marker.nodeId) return
  if (editor.value && !dismissEditor()) return
  batchOpen.value = false
  const saved = drafts.value.find((draft) => draft.item.nodeId === marker.nodeId)
  editor.value = {
    key: scopeKey.value,
    node: marker.node,
    ...target
  }
  editorText.value = saved?.item.text ?? ''
  editorError.value = ''
}

async function submitEditor(mode: DesignFeedback['mode']): Promise<void> {
  if (!hasEditorContent.value || submitting.value || deliveryPending.value) return
  const immediate = metaPressed.value
  const target = editor.value
  const token = generation
  submitting.value = 'editor'
  try {
    if (!(await saveDraft(!immediate)) || token !== generation) return
    if (immediate && editor.value === target) await sendBatch(mode, true)
  } finally {
    if (token === generation) submitting.value = null
  }
}

async function saveDraft(closeEditor = true): Promise<boolean> {
  const target = editor.value
  const draftScope = scope.value
  if (!target || target.key !== scopeKey.value) return false
  if (!draftScope || !props.requestDrafts || busy.value) {
    showError(busy.value ? 'Comments are updating…' : 'Could not save the comment.')
    return false
  }
  editorError.value = ''
  const parsed = DesignFeedbackItemSchema.safeParse({
    nodeId: target.nodeId,
    nodeName: target.nodeName.slice(0, 256),
    pageId: target.pageId,
    ...(target.pageName ? { pageName: target.pageName } : {}),
    ...(target.frame ? { frame: target.frame } : {}),
    text: editorText.value,
    createdAt: Date.now()
  })
  if (!parsed.success) {
    editorError.value = 'Enter a comment of up to 8,000 characters.'
    return false
  }
  const index = drafts.value.findIndex((draft) => draft.item.nodeId === target.nodeId)
  const saved = drafts.value[index]?.item
  if (saved && sameFeedbackItem(saved, { ...parsed.data, createdAt: saved.createdAt })) {
    // Reopening and saving an unchanged note must not create a new delivery ID.
    if (closeEditor) editor.value = null
    return true
  }
  if (index < 0 && drafts.value.length >= MCP_DESIGN_FEEDBACK_MAX_ITEMS) {
    editorError.value = `Send this batch before adding more than ${MCP_DESIGN_FEEDBACK_MAX_ITEMS} elements.`
    return false
  }
  const token = generation
  persisting.value = true
  try {
    const snapshot = await props.requestDrafts({
      operation: 'save',
      scope: draftScope,
      item: parsed.data
    })
    if (token !== generation) return false
    installSnapshot(snapshot, target.node)
    if (closeEditor && editor.value === target) editor.value = null
    if (scopeKey.value === target.key) requestError.value = ''
    return true
  } catch (error) {
    if (token === generation && editor.value === target)
      editorError.value = error instanceof Error ? error.message : 'Could not save the comment.'
    return false
  } finally {
    if (token === generation) persisting.value = false
  }
}

async function removeDraft(nodeId: string): Promise<void> {
  const draftScope = scope.value
  if (!draftScope || !props.requestDrafts || busy.value) return
  const token = generation
  const key = scopeKey.value
  persisting.value = true
  requestError.value = ''
  try {
    const snapshot = await props.requestDrafts({ operation: 'remove', scope: draftScope, nodeId })
    if (token !== generation) return
    installSnapshot(snapshot)
    if (editor.value?.key === key && editor.value.nodeId === nodeId) editor.value = null
    if (scopeKey.value === key) requestError.value = ''
  } catch (error) {
    if (token === generation)
      requestError.value = error instanceof Error ? error.message : 'Could not delete the comment.'
  } finally {
    if (token === generation) persisting.value = false
  }
}
function reviewDraft(draft: Draft): void {
  if (
    !draft.node ||
    draft.node.removed ||
    readFigmaSession(props.sessionId, false)?.fileKey !== scope.value?.fileKey
  )
    return
  const page = getContainingPage(draft.node)
  if (!page) return
  window.figma.currentPage = page
  window.figma.viewport.scrollAndZoomIntoView([draft.node])
  openEditor({ node: draft.node, nodeId: draft.item.nodeId })
}

function feedbackSignature({
  fileKey,
  mode,
  comment,
  items
}: Pick<DesignFeedback, 'fileKey' | 'mode' | 'comment' | 'items'>): string {
  return JSON.stringify({ fileKey, mode, comment, items })
}

function isDeliveryInterrupted(): boolean {
  return ['stopping', 'cancelled', 'interrupted'].includes(props.task.status)
}

async function sendBatch(
  mode: DesignFeedback['mode'] = 'queue',
  fromEditor = false
): Promise<void> {
  if (!hasContent.value || deliveryPending.value || (submitting.value && !fromEditor)) return
  requestError.value = ''
  if (submissionBlockedHint.value) {
    showError(submissionBlockedHint.value)
    return
  }
  const token = generation
  const submittedEditor = editor.value
  let feedbackId: string | undefined
  submitting.value = fromEditor ? 'editor' : 'batch'
  try {
    if (!(await saveComment()) || token !== generation || busy.value) return
    if (submissionBlockedHint.value) {
      showError(submissionBlockedHint.value)
      return
    }
    const items = drafts.value.map((draft) => ({ ...draft.item }))
    const batch = {
      fileKey: props.task.target.fileKey,
      mode,
      ...(savedComment.value ? { comment: savedComment.value } : {}),
      items
    }
    const parsed = DesignFeedbackSchema.safeParse(
      attempt && feedbackSignature(attempt) === feedbackSignature(batch)
        ? attempt
        : {
            id: crypto.randomUUID(),
            ...batch,
            createdAt: Date.now()
          }
    )
    if (!parsed.success) {
      requestError.value = 'Keep these comments within 32,000 characters in total.'
      return
    }
    const feedback = parsed.data
    feedbackId = feedback.id
    attempt = feedback
    deliveries.set(feedback.id, feedback)
    sending.value = true
    if (!props.sendFeedback) throw new Error('The agent connection is unavailable.')
    const result = await props.sendFeedback(feedback)
    // A final receipt may beat this initial response. Never revive a settled batch.
    if (token !== generation || !deliveries.has(feedback.id)) return
    if (result.status === 'accepted') {
      if (!isDeliveryInterrupted()) queuedFeedbackId.value = feedback.id
    } else if (result.status === 'failed') {
      deliveries.delete(feedback.id)
      requestError.value = result.message || 'Sending not confirmed.'
      return
    }
    if (result.status === 'delivered') acknowledgeDelivery(feedback.id)
    batchOpen.value = false
    if (editor.value === submittedEditor) cancelEditor()
  } catch (error) {
    if (token === generation && (!feedbackId || deliveries.has(feedbackId)))
      requestError.value = error instanceof Error ? error.message : 'Could not send comments.'
  } finally {
    if (token === generation) {
      sending.value = false
      submitting.value = null
    }
  }
}

function submitOnEnter(
  event: KeyboardEvent,
  submit: (mode: DesignFeedback['mode']) => unknown,
  mode: DesignFeedback['mode']
): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  void submit(mode)
}

onClickOutside(editorElement, dismissEditor, {
  ignore: ['.tp-feedback-marker-position', batchTrigger]
})

function dismissEditor(): boolean {
  if (!editor.value || busy.value) return false
  if (editorHasChanges.value && !editorWarned.value) {
    editorWarned.value = true
    return false
  }
  cancelEditor()
  return true
}

function cancelEditor(): void {
  editor.value = null
  editorError.value = ''
}

function acknowledgeDelivery(requestId: string): void {
  const feedback = deliveries.get(requestId)
  if (!feedback) return
  if (sending.value && attempt?.id === requestId) {
    batchOpen.value = false
    cancelEditor()
  }
  deliveries.delete(requestId)
  if (queuedFeedbackId.value === requestId) queuedFeedbackId.value = null
  if (attempt?.id === requestId) attempt = undefined
  if (feedback.comment) {
    if (savedComment.value === feedback.comment) savedComment.value = ''
    if (commentText.value.trim() === feedback.comment) commentText.value = ''
  }
  const token = generation
  deliveredItems.push(...feedback.items)
  const submitted = (draft: Draft) =>
    deliveredItems.some((item) => sameFeedbackItem(draft.item, item))
  fadingNodes.value = new Set(drafts.value.filter(submitted).map((draft) => draft.item.nodeId))
  fading.value = true
  suppressedNode.value = selectedNodeId
  requestError.value = ''
  clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    if (token !== generation) return
    drafts.value = drafts.value.filter((draft) => !submitted(draft))
    deliveredItems = []
    fadingNodes.value = new Set()
    fading.value = false
    void loadDrafts()
  }, 220)
}

watch(
  () => props.actionResult,
  (result) => {
    if (!result || result.taskId !== props.task.taskId || !deliveries.has(result.requestId)) return
    if (
      result.status === 'accepted' &&
      attempt?.id === result.requestId &&
      !isDeliveryInterrupted()
    ) {
      // A transport timeout can precede acceptance. Only lock the unchanged submitted batch.
      queuedFeedbackId.value = result.requestId
      requestError.value = ''
    }
    if (result.status === 'delivered') {
      // A final receipt can arrive after the page's waiting deadline has elapsed.
      acknowledgeDelivery(result.requestId)
    } else if (result.status === 'failed') {
      deliveries.delete(result.requestId)
      requestError.value = result.message
      if (queuedFeedbackId.value === result.requestId) queuedFeedbackId.value = null
    }
  }
)
watch(
  () => props.task.status,
  () => {
    if (isDeliveryInterrupted()) queuedFeedbackId.value = null
  }
)

const projection = shallowRef<{
  clip: ReturnType<typeof canvasClipStyle>
  markers: Marker[]
  editor: { left: string; top: string; width: string; maxHeight: string } | null
  batch: { left: string; top: string; width: string; maxHeight: string } | null
} | null>(null)
let previousProjection = ''
let previousPage = ''
function updateProjection(frame: CanvasOverlayFrame | null): void {
  if (
    !commentsEnabled.value ||
    !frame ||
    (frame.fileKey && frame.fileKey !== scope.value?.fileKey)
  ) {
    projection.value = null
    previousProjection = ''
    hideAddAt = undefined
    hoveredMarker.value = null
    return
  }
  const pageKey = `${frame.fileKey}/${frame.pageId}`
  if (previousPage !== pageKey) {
    previousPage = pageKey
    hoveredMarker.value = null
    hideAddAt = undefined
    if (scope.value) void hydrateNodes()
  }
  editorMultiline.value = (editorInput.value?.offsetHeight ?? 28) > 28
  commentMultiline.value = (commentInput.value?.offsetHeight ?? 28) > 28
  const { canvas } = frame
  const selected = frame.selectedNode
  const nativeControls = selectionActionBounds(frame)
  if (selected?.id !== selectedNodeId) {
    suppressedNode.value = null
    hoveredMarker.value = null
    hideAddAt = undefined
  }
  selectedNodeId = selected?.id ?? null
  const markers: Marker[] = []
  function position(node: SceneNode, allowOffscreen = false): { x: number; y: number } | null {
    try {
      if (visibleNodePage(node) !== frame!.pageId || !node.absoluteBoundingBox) return null
      const rect = projectCanvasAnchor(node.absoluteBoundingBox, frame!.bounds, frame!.zoom)
      if (
        !rect ||
        (!allowOffscreen &&
          (rect.x + rect.width < 0 ||
            rect.y + rect.height < 0 ||
            rect.x > canvas.width ||
            rect.y > canvas.height))
      )
        return null
      const point = { x: rect.x + rect.width + 9, y: rect.y + 28 }
      if (allowOffscreen) return point
      const size = 16
      return {
        // Align below the native 16px Agent entry, with an 8px gap.
        x: Math.max(8, Math.min(point.x, canvas.width - size - 8)),
        y: Math.max(8, Math.min(point.y, canvas.height - size - 8))
      }
    } catch {
      return null
    }
  }
  function add(node: SceneNode, number: number | null): void {
    const point = position(node)
    if (!point) return
    const size = 16
    // Nested elements can share a corner. Keep their numbered targets independently clickable.
    while (
      (nativeControls &&
        canvasRectsOverlap({ ...point, width: size, height: size }, nativeControls)) ||
      markers.some(
        (marker) => Math.abs(marker.x - point.x) < 30 && Math.abs(marker.y - point.y) < 30
      )
    ) {
      if (point.y + size + 40 <= canvas.height) point.y += 32
      else if (point.x >= 40) {
        point.x -= 32
        point.y = Math.max(8, point.y - 32)
      } else return
    }
    const rect =
      number === null && node.absoluteBoundingBox
        ? projectCanvasAnchor(node.absoluteBoundingBox, frame!.bounds, frame!.zoom)
        : null
    const x = pointer ? pointer.x - canvas.left : null
    const y = pointer ? pointer.y - canvas.top : null
    const wasRevealed = projection.value?.markers.some(
      (marker) => marker.nodeId === node.id && marker.number === null && marker.revealed
    )
    // The selected element is a canvas shape; its entry test must use projection.
    // Retain travel passively so native controls and resize handles keep their hit targets.
    let revealed =
      number !== null ||
      editor.value?.nodeId === node.id ||
      hoveredMarker.value === node.id ||
      !!(
        rect &&
        x !== null &&
        y !== null &&
        x >= 0 &&
        x <= canvas.width &&
        y >= 0 &&
        y <= canvas.height &&
        canvasHoverContains({ x, y }, [
          rect,
          ...(wasRevealed
            ? [{ x: point.x - 4, y: point.y - 4, width: size + 8, height: size + 8 }]
            : [])
        ])
      )
    if (number === null) {
      if (revealed) hideAddAt = undefined
      else if (wasRevealed) {
        const now = performance.now()
        hideAddAt ??= now + 100
        revealed = now < hideAddAt
      }
    }
    const occluded = (frame!.tooltips ?? []).some((tooltip) =>
      canvasRectsOverlap(
        { x: canvas.left + point.x, y: canvas.top + point.y, width: size, height: size },
        tooltip
      )
    )
    markers.push({ node, nodeId: node.id, number, ...point, revealed, occluded })
  }
  drafts.value.forEach((draft, index) => {
    if (draft.node) add(draft.node, index + 1)
  })
  if (
    canDraft.value &&
    ready.value &&
    !busy.value &&
    selected &&
    selected.id !== suppressedNode.value &&
    !drafts.value.some((draft) => draft.item.nodeId === selected.id)
  )
    add(selected, null)
  const target =
    editor.value &&
    (markers.find((marker) => marker.nodeId === editor.value!.nodeId) ??
      position(editor.value.node, true))
  const width = Math.max(0, Math.min(300, canvas.width - 16))
  const popup =
    target &&
    placeCanvasPopover(
      { ...target, width: 16, height: 16 },
      { width, height: Math.min(editorHeight.value, Math.max(0, canvas.height - 16)) },
      canvas
    )
  const editorPosition = popup
    ? {
        left: `${popup.x}px`,
        top: `${popup.y}px`,
        width: `${width}px`,
        maxHeight: `${canvas.height - 16}px`
      }
    : null
  const trigger = batchOpen.value ? batchTrigger.value : null
  const anchor = (trigger?.closest('.tp-design-feedback') ?? trigger)?.getBoundingClientRect()
  const below = (anchor?.bottom ?? 0) - canvas.top + 8
  const above = (anchor?.top ?? 0) - canvas.top - batchHeight.value - 8
  const batchPosition = anchor?.width
    ? {
        left: `${Math.max(8, Math.min(anchor.right - canvas.left - width, canvas.width - width - 8))}px`,
        top: `${Math.max(8, Math.min(below + batchHeight.value <= canvas.height - 8 ? below : above, canvas.height - batchHeight.value - 8))}px`,
        width: `${width}px`,
        maxHeight: `${canvas.height - 16}px`
      }
    : null
  const next = {
    clip: canvasClipStyle(canvas),
    markers,
    editor: editorPosition,
    batch: batchPosition
  }
  const serialized = JSON.stringify({
    ...next,
    markers: markers.map(({ node: _node, ...marker }) => marker)
  })
  if (serialized !== previousProjection) {
    projection.value = next
    previousProjection = serialized
  }
}

let stopObserving: (() => void) | undefined
watch(
  () =>
    commentsEnabled.value &&
    (canDraft.value || drafts.value.length > 0 || !!editor.value || batchOpen.value),
  (observe) => {
    stopObserving?.()
    stopObserving = observe ? observeCanvasOverlay(updateProjection) : undefined
    previousProjection = ''
    if (!observe) projection.value = null
  },
  { immediate: true }
)

watch(
  () =>
    draftsBusy.value ||
    (commentsEnabled.value &&
      props.task.status !== 'completed' &&
      (editorHasChanges.value || !!commentError.value)),
  (blocked) => emit('dismissBlocked', blocked),
  { immediate: true }
)
watch(commentsEnabled, (enabled) => {
  if (enabled && !ready.value) void loadDrafts()
})
watch(
  () => [scopeKey.value, local.value, props.requestDrafts],
  () => {
    generation++
    clearTimeout(loadRetryTimer)
    loadRetryDelay = 1000
    clearTimeout(clearTimer)
    clearTimeout(commentTimer)
    pendingComment = undefined
    commentSaving.value = false
    commentText.value = ''
    savedComment.value = ''
    commentError.value = ''
    batchOpen.value = false
    cancelEditor()
    deliveries.clear()
    attempt = undefined
    drafts.value = []
    sending.value = false
    submitting.value = null
    queuedFeedbackId.value = null
    fading.value = false
    fadingNodes.value = new Set()
    deliveredItems = []
    persisting.value = false
    loading.value = false
    clearing.value = false
    previousProjection = ''
    previousPage = ''
    projection.value = null
    suppressedNode.value = null
    hoveredMarker.value = null
    hideAddAt = undefined
    ready.value = false
    requestError.value = ''
    void loadDrafts()
  },
  { immediate: true }
)
onScopeDispose(() => {
  generation++
  clearTimeout(loadRetryTimer)
  stopObserving?.()
  clearTimeout(clearTimer)
  clearTimeout(commentTimer)
})
</script>

<template>
  <Button
    v-if="commentsEnabled"
    ref="batchButton"
    class="tp-feedback-toggle"
    :aria-expanded="batchOpen"
    :aria-busy="deliveryPending"
    aria-haspopup="dialog"
    :aria-label="
      sending
        ? 'Sending comments'
        : drafts.length
          ? `Review ${drafts.length} comments`
          : 'Review comments'
    "
    :data-tooltip="triggerHint"
    data-tooltip-type="text"
    :disabled="!canDraft || sending"
    @click.stop="toggleBatch"
  >
    <Spinner v-if="deliveryPending" class="tp-feedback-spinner" aria-hidden="true" />
    <Comment v-else aria-hidden="true" /><span v-if="drafts.length">{{ drafts.length }}</span>
  </Button>
  <Teleport to="tempad">
    <div
      v-if="projection"
      class="tp-element-feedback tp-feedback-markers"
      :style="projection.clip"
      @pointerdown.stop
      @keydown.stop
    >
      <div
        v-for="marker in projection.markers"
        :key="`${task.taskId}:${task.epoch ?? 0}:${marker.nodeId}`"
        v-show="!marker.occluded && editor?.nodeId !== marker.nodeId"
        class="tp-feedback-marker-position"
        :style="{ transform: `translate(${marker.x}px, ${marker.y}px)` }"
        @mouseenter="hoveredMarker = marker.nodeId"
        @mouseleave="hoveredMarker === marker.nodeId && (hoveredMarker = null)"
      >
        <button
          type="button"
          class="tp-feedback-marker"
          :class="{
            'tp-feedback-marker-sent': fadingNodes.has(marker.nodeId),
            'tp-feedback-marker-draft': marker.number !== null,
            'tp-feedback-marker-add': marker.number === null,
            'tp-feedback-marker-revealed': marker.revealed
          }"
          :disabled="busy || marker.occluded"
          :aria-label="
            marker.number === null
              ? `Add comment to ${marker.node.name}`
              : `Edit comment ${marker.number} for ${marker.node.name}`
          "
          :data-tooltip="marker.number === null ? 'Add comment' : `Comment ${marker.number}`"
          data-tooltip-type="text"
          @click.stop="openEditor(marker)"
        >
          <Comment v-if="marker.number === null" aria-hidden="true" /><span v-else>{{
            marker.number
          }}</span>
        </button>
      </div>
    </div>
    <div
      v-if="projection"
      class="tp-element-feedback"
      :style="projection.clip"
      @pointerdown.stop
      @keydown.stop
    >
      <Transition name="tp-feedback-popup">
        <section
          v-if="batchOpen && projection.batch"
          ref="batchElement"
          class="tp-feedback-review"
          :style="projection.batch"
          role="dialog"
          tabindex="-1"
          aria-label="Review comments"
          @keydown.esc.prevent.stop="closeBatch"
        >
          <ol v-if="drafts.length">
            <li v-for="(draft, index) in drafts" :key="draft.item.nodeId">
              <button
                type="button"
                class="tp-feedback-review-item"
                :disabled="busy || !draft.node || draft.node.removed"
                @click="reviewDraft(draft)"
              >
                <span
                  :title="
                    [draft.item.pageName, draft.item.frame?.nodeName].filter(Boolean).join(' / ')
                  "
                  >{{ index + 1 }}. {{ draft.item.nodeName || draft.item.nodeId }}</span
                >
                <small :class="{ 'tp-feedback-excerpt': draft.node && !draft.node.removed }">{{
                  draft.item.text
                }}</small>
                <small v-if="!draft.node || draft.node.removed">Element unavailable</small>
              </button>
              <IconButton
                class="tp-feedback-remove"
                :title="`Delete comment ${index + 1}`"
                :disabled="busy"
                @click="removeDraft(draft.item.nodeId)"
              >
                <Times />
              </IconButton>
            </li>
          </ol>
          <div
            class="tp-feedback-composer"
            :class="{
              'tp-feedback-multiline': commentMultiline
            }"
          >
            <textarea
              id="tp-feedback-comment"
              ref="commentInput"
              v-model="commentText"
              aria-label="General comment"
              rows="1"
              maxlength="8000"
              placeholder="Add a general comment…"
              :disabled="!canDraft || !ready || draftsBusy || !!submitting"
              @keydown="submitOnEnter($event, sendBatch, batchMode)"
              @input="commentError = ''"
            />
            <IconButton
              class="tp-feedback-submit tp-feedback-send"
              :aria-label="batchMode === 'steer' ? 'Steer comments' : 'Queue comments'"
              :aria-busy="!!submitting || deliveryPending || loading"
              :disabled="!hasContent || !!queuedFeedbackId"
              @click="sendBatch(batchMode)"
              ><ArrowUp
            /></IconButton>
          </div>
          <Button v-if="commentError" :disabled="!commentText.trim()" @click="saveComment">
            Retry saving comment
          </Button>
        </section>
      </Transition>
      <Transition name="tp-feedback-popup">
        <form
          v-if="editor && projection.editor"
          ref="editorElement"
          class="tp-feedback-editor"
          :class="{ 'tp-feedback-editor-warned': editorWarned }"
          :style="projection.editor"
          aria-label="Element comment draft"
          @submit.prevent="submitEditor(editorMode)"
          @keydown.esc.prevent.stop="cancelEditor"
        >
          <header v-if="editedDraft">
            <strong :title="editor.nodeName">{{ editor.nodeName }}</strong>
            <Button class="tp-feedback-delete" :disabled="busy" @click="removeDraft(editor.nodeId)">
              Delete
            </Button>
          </header>
          <div class="tp-feedback-composer" :class="{ 'tp-feedback-multiline': editorMultiline }">
            <textarea
              id="tp-element-feedback-text"
              ref="editorInput"
              v-model="editorText"
              aria-label="Element comment"
              rows="1"
              maxlength="8000"
              placeholder="Add a comment…"
              :disabled="busy || !!submitting"
              @keydown="submitOnEnter($event, submitEditor, editorMode)"
            />
            <IconButton
              class="tp-feedback-submit"
              type="submit"
              :aria-label="metaPressed && hasEditorContent ? 'Steer comments' : 'Save comment'"
              :aria-busy="submitting === 'editor'"
              :disabled="!hasEditorContent"
              ><ArrowUp v-if="metaPressed && hasEditorContent" /><Check
                v-else
                class="tp-feedback-check"
            /></IconButton>
          </div>
        </form>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.tp-feedback-toggle {
  position: relative;
  height: 24px;
  gap: 4px;
  padding: 0 8px;
  flex: none;
}
.tp-feedback-toggle svg {
  width: 13px;
  height: 13px;
}

.tp-feedback-review-item:focus-visible,
.tp-feedback-marker:focus-visible {
  outline: 1px solid var(--color-border-selected, #0d99ff);
  outline-offset: -1px;
}
.tp-feedback-review-item:disabled {
  opacity: 0.5;
}
.tp-element-feedback {
  position: fixed;
  z-index: 20;
  overflow: hidden;
  pointer-events: none;
  color: var(--color-text, light-dark(#333, #fff));
  font: 11px/16px var(--font-family-ui, Inter, sans-serif);
}
.tp-feedback-markers {
  z-index: 0;
}
.tp-feedback-review,
.tp-feedback-editor {
  position: absolute;
  display: grid;
  gap: 8px;
  padding: var(--spacer-12px, 12px);
  box-sizing: border-box;
  overflow: auto;
  pointer-events: auto;
  background: var(--color-bg, light-dark(#fff, #2c2c2c));
  border: 0;
  border-radius: var(--radius-large, 13px);
  box-shadow: var(
    --elevation-200-canvas,
    0 0 0.5px #0000002e,
    0 3px 8px #0000001a,
    0 1px 3px #0000001a
  );
  outline: none;
}
.tp-feedback-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  gap: var(--spacer-2, 8px);
}
.tp-feedback-multiline > .tp-feedback-submit {
  grid-column: 2;
  grid-row: 2;
}
.tp-feedback-composer textarea {
  cursor: default;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  max-height: 240px;
  field-sizing: content;
  resize: none;
  border: 0;
  border-radius: var(--radius-medium, 5px);
  padding: var(--spacer-1, 4px) var(--spacer-2, 8px);
  background: transparent;
  font-family: var(--text-body-large-font-family, Inter, sans-serif);
  font-size: var(--text-body-large-font-size, 13px);
  font-weight: 400;
  letter-spacing: var(--text-body-large-letter-spacing, -0.032px);
  line-height: 20px;
}
.tp-feedback-submit {
  --icon-button-size: var(--spacer-4, 24px);
  --icon-button-radius: var(--radius-full, 9999px);
  --icon-button-icon: var(--color-icon-onbrand, #fff);
  --icon-button-color-bg: var(--color-bg-brand, #0d99ff);
  place-items: center;
  flex: none;
}
.tp-feedback-submit:hover:not(:disabled) {
  --icon-button-icon: var(--color-icon-onbrand, #fff);
  --icon-button-color-bg: var(--color-bg-brand-hover, #007be5);
}
.tp-feedback-submit:disabled {
  --icon-button-icon: var(--color-icon-ondisabled, #fff);
  --icon-button-color-bg: var(--color-bg-disabled, #d9d9d9);
}
.tp-feedback-submit .tp-feedback-check {
  width: 16px;
  height: 16px;
}
.tp-feedback-popup-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  pointer-events: none;
}
.tp-feedback-popup-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
.tp-feedback-spinner {
  width: 14px;
  height: 14px;
  flex: none;
  fill: none;
  color: var(--color-icon-secondary, #808080);
  animation: tp-feedback-spin 1s linear infinite;
}
@keyframes tp-feedback-spin {
  to {
    transform: rotate(360deg);
  }
}
.tp-feedback-editor header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tp-feedback-editor strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.tp-feedback-review ol {
  max-height: 208px;
  overflow: auto;
  list-style: none;
  padding: 0;
  margin: 0;
}
.tp-feedback-review li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.tp-feedback-review-item {
  min-width: 0;
  flex: 1;
  display: block;
  place-items: start;
  border: 0;
  border-radius: var(--radius-medium, 4px);
  padding: 2px 4px;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
}
.tp-feedback-review-item:hover:not(:disabled) {
  background: var(--color-bg-hover, rgb(127 127 127 / 10%));
}
.tp-feedback-review-item span,
.tp-feedback-review-item small {
  display: block;
  overflow-wrap: anywhere;
}
.tp-feedback-review-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tp-feedback-review-item .tp-feedback-excerpt {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.tp-feedback-review-item small {
  color: var(--color-text-secondary, light-dark(#666, #aaa));
  font: inherit;
}
.tp-feedback-delete {
  height: var(--spacer-4, 24px);
  padding: 0 var(--spacer-2, 8px);
}
.tp-feedback-remove {
  --icon-button-icon-size: 16px;
  flex: none;
}
.tp-feedback-marker-position {
  position: absolute;
  top: 0;
  left: 0;
}
.tp-feedback-marker {
  position: relative;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  corner-shape: squircle;
  background: var(--color-bg, light-dark(#fff, #2c2c2c));
  color: var(--color-icon-brand, #0d99ff);
  box-shadow: none;
  font: 500 11px/1 var(--font-family-ui, Inter, sans-serif);
  cursor: default;
  pointer-events: auto;
  transition:
    transform 220ms ease-in,
    opacity 220ms ease-in;
}
.tp-feedback-marker svg {
  width: 12px;
  height: 12px;
}
.tp-feedback-marker-draft {
  background: var(--color-bg-brand, #0d99ff);
  color: var(--color-text-onbrand, #fff);
  border-color: transparent;
}
.tp-feedback-marker-add {
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease-out;
}
.tp-feedback-marker-add svg {
  stroke-width: 1.6;
}
.tp-feedback-marker-add.tp-feedback-marker-revealed,
.tp-feedback-marker-add:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
.tp-feedback-marker-add:hover,
.tp-feedback-marker-add:focus-visible {
  --comment-inner-stroke: var(--color-icon-onbrand, #fff);
  background: var(--color-bg-brand, #0d99ff);
}
.tp-feedback-editor-warned {
  transform-origin: 24px 50%;
  animation: tp-feedback-unsaved 420ms ease-out;
}
@keyframes tp-feedback-unsaved {
  0%,
  100% {
    transform: translateX(0) rotate(0);
  }
  18% {
    transform: translateX(-10px) rotate(-3deg);
  }
  42% {
    transform: translateX(6px) rotate(2deg);
  }
  66% {
    transform: translateX(-4px) rotate(-1deg);
  }
  84% {
    transform: translateX(2px) rotate(0.5deg);
  }
}
@media (hover: none) {
  .tp-feedback-marker-add {
    opacity: 1;
    pointer-events: auto;
  }
}
.tp-feedback-marker-sent {
  transform: scale(0.4);
  opacity: 0;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .tp-feedback-popup-leave-active {
    transition: none;
  }
  .tp-feedback-spinner {
    animation: none;
  }
  .tp-feedback-editor-warned {
    animation: none;
  }
  .tp-feedback-marker {
    transition: none;
  }
}
</style>
