<script setup lang="ts">
import { onClickOutside, unrefElement, useEventListener } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

import Button from '@/components/Button.vue'
import IconButton from '@/components/IconButton.vue'
import ArrowUp from '@/components/icons/ArrowUp.vue'
import Check from '@/components/icons/Check.vue'
import Comment from '@/components/icons/Comment.vue'
import Spinner from '@/components/icons/Spinner.vue'
import Times from '@/components/icons/Times.vue'
import { useFeedbackCanvas } from '@/composables/feedback-canvas'
import {
  useFeedbackState,
  type FeedbackDraft,
  type FeedbackStateOptions
} from '@/composables/feedback-state'
import { useToast } from '@/composables/toast'
import { FEEDBACK_DRAFT_CONFLICT_MESSAGE } from '@/mcp/design-feedback'
import { readFigmaSession } from '@/mcp/figma-session'
import { getContainingPage } from '@/mcp/local-resources'

const props = defineProps<FeedbackStateOptions>()
const { show: showError } = useToast()
const emit = defineEmits<{
  dismissBlocked: [blocked: boolean]
}>()

const {
  scope,
  drafts,
  editor,
  editorText,
  editedDraft,
  editorError,
  editorWarned,
  batchOpen,
  commentText,
  commentError,
  requestError,
  sending,
  submitting,
  queuedFeedbackId,
  fadingNodes,
  loading,
  ready,
  deliveryPending,
  draftsBusy,
  busy,
  commentsEnabled,
  canDraft,
  hasContent,
  hasEditorContent,
  hasUnsentContent,
  dismissBlocked,
  saveComment,
  prepareDismiss,
  hydrateNodes,
  loadDrafts,
  openEditor,
  submitEditor: saveEditor,
  removeDraft,
  sendBatch,
  dismissEditor,
  cancelEditor,
  bindCanvas
} = useFeedbackState(props, showError)

defineExpose({ prepareDismiss, hasUnsentContent })

const editorElement = shallowRef<HTMLElement | null>(null)
const editorInput = shallowRef<HTMLTextAreaElement | null>(null)
watch(
  [editorInput, () => editor.value?.nodeId],
  ([input]) => input?.focus({ preventScroll: true }),
  {
    flush: 'post'
  }
)
const batchButton = shallowRef<InstanceType<typeof Button> | null>(null)
const batchTrigger = computed(() => unrefElement(batchButton))
const batchElement = shallowRef<HTMLElement | null>(null)
const commentInput = shallowRef<HTMLTextAreaElement | null>(null)
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
onClickOutside(batchElement, () => (batchOpen.value = false), { ignore: [batchTrigger] })

const submitModifierPressed = shallowRef(false)
useEventListener(
  window,
  'keydown',
  (event) => (submitModifierPressed.value = event.metaKey || event.ctrlKey),
  {
    capture: true
  }
)
useEventListener(
  window,
  'keyup',
  (event) => (submitModifierPressed.value = event.metaKey || event.ctrlKey),
  { capture: true }
)
useEventListener(window, 'blur', () => {
  submitModifierPressed.value = false
})
const batchMode = computed(() =>
  submitModifierPressed.value && hasContent.value ? 'steer' : 'queue'
)
const editorAction = computed(() =>
  submitModifierPressed.value && hasEditorContent.value ? 'Save & Queue' : 'Save comment'
)
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

function reviewDraft(draft: FeedbackDraft): void {
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

function submitEditor(event?: KeyboardEvent | MouseEvent): Promise<void> {
  return saveEditor(!!(event?.metaKey || event?.ctrlKey))
}

function submitBatch(event: KeyboardEvent | MouseEvent): Promise<void> {
  return sendBatch(event.metaKey || event.ctrlKey ? 'steer' : 'queue')
}

function submitOnEnter(event: KeyboardEvent, submit: (event: KeyboardEvent) => unknown): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  void submit(event)
}

onClickOutside(editorElement, dismissEditor, {
  ignore: ['.tp-feedback-marker-position', batchTrigger]
})

const canvas = useFeedbackCanvas(
  () => ({
    enabled: commentsEnabled.value,
    fileKey: scope.value?.fileKey,
    canDraft: canDraft.value,
    canAdd: canDraft.value && ready.value && !busy.value,
    drafts: drafts.value,
    editor: editor.value,
    batchOpen: batchOpen.value
  }),
  {
    editor: editorElement,
    editorInput,
    batch: batchElement,
    commentInput,
    batchTrigger: () => batchTrigger.value
  },
  () => void hydrateNodes()
)
const { projection, hoveredMarker, editorMultiline, commentMultiline } = canvas

watch(dismissBlocked, (blocked) => emit('dismissBlocked', blocked), { immediate: true })
bindCanvas(canvas)
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
          ? `Review ${drafts.length} ${drafts.length === 1 ? 'comment' : 'comments'}`
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
              @keydown="submitOnEnter($event, submitBatch)"
              @input="commentError = ''"
            />
            <IconButton
              class="tp-feedback-submit tp-feedback-send"
              :title="batchMode === 'steer' ? 'Steer now' : 'Queue comments'"
              :aria-busy="!!submitting || deliveryPending || loading"
              :disabled="!hasContent || !!queuedFeedbackId"
              @click="submitBatch"
              ><ArrowUp
            /></IconButton>
          </div>
          <Button v-if="commentError" :disabled="!commentText.trim()" @click="saveComment">
            Retry saving comment
          </Button>
          <Button
            v-if="requestError === FEEDBACK_DRAFT_CONFLICT_MESSAGE"
            :disabled="busy"
            @click="loadDrafts"
          >
            Reload saved comments
          </Button>
          <p v-if="commentError || requestError" role="alert">{{ commentError || requestError }}</p>
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
          @submit.prevent="submitEditor()"
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
              @keydown="submitOnEnter($event, submitEditor)"
            />
            <IconButton
              class="tp-feedback-submit"
              type="submit"
              :title="editorAction"
              :aria-busy="submitting === 'editor'"
              :disabled="!hasEditorContent"
              @click.prevent="submitEditor"
              ><ArrowUp v-if="submitModifierPressed && hasEditorContent" /><Check
                v-else
                class="tp-feedback-check"
            /></IconButton>
          </div>
          <p v-if="editorError" role="alert">{{ editorError }}</p>
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
