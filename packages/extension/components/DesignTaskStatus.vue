<script setup lang="ts">
import type {
  DesignTask,
  DesignFeedback,
  DesignActionResult,
  FeedbackDraftRequest,
  FeedbackDraftSnapshot
} from '@tempad-dev/shared'

import { AGENT_CLIENTS } from '@tempad-dev/shared'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, onScopeDispose, shallowRef, watch } from 'vue'

import Button from '@/components/Button.vue'
import DesignTaskFeedback from '@/components/DesignTaskFeedback.vue'
import TemPadLogo from '@/components/icons/TemPadLogo.vue'
import Section from '@/components/Section.vue'
import { useToast } from '@/composables/toast'
import {
  canvasClipStyle,
  observeCanvasOverlay,
  projectCanvasAnchor,
  type CanvasOverlayFrame
} from '@/mcp/canvas-overlay'
import { getContainingPage } from '@/mcp/local-resources'
import { getCanvas } from '@/utils/figma'

const props = defineProps<{
  task: DesignTask | null
  anchor: SceneNode | null
  sessionId: string
  restored?: boolean
  actionResult?: DesignActionResult | null
  sendFeedback?: (feedback: DesignFeedback) => Promise<DesignActionResult>
  closeReview?: (taskId: string) => Promise<void>
  requestDrafts?: (request: FeedbackDraftRequest) => Promise<FeedbackDraftSnapshot>
}>()
const { show: showError } = useToast()
const emit = defineEmits<{ stop: []; done: [taskId: string] }>()

const stoppable = computed(
  () => !!props.task && !['completed', 'cancelled'].includes(props.task.status)
)
const dismissBlocked = shallowRef(false)
const feedbackComponent = shallowRef<InstanceType<typeof DesignTaskFeedback> | null>(null)
const finishing = shallowRef(false)
const feedbackSupported = computed(
  () => AGENT_CLIENTS[props.task?.client?.kind ?? 'other'].feedback
)
watch(feedbackSupported, (supported) => {
  if (!supported) dismissBlocked.value = false
})
const currentFileKey = shallowRef<string | null>(null)
const sameFile = computed(
  () => !currentFileKey.value || currentFileKey.value === props.task?.target.fileKey
)
const panelControls = shallowRef<HTMLElement | null>(null)
const toolbar = shallowRef<HTMLElement | null>(null)
const toolbarOffset = 64
const retainedAnchor = shallowRef<SceneNode | null>(null)
const exitPhase = shallowRef<'collapsing' | 'exiting' | null>(null)
const dismissed = shallowRef(false)
let exitTimer: ReturnType<typeof setTimeout> | undefined

async function done() {
  const taskId = props.task?.taskId
  if (!taskId || stoppable.value || dismissBlocked.value || exitPhase.value || finishing.value)
    return
  finishing.value = true
  try {
    const completed = props.task?.status === 'completed'
    const close = completed && props.closeReview ? () => props.closeReview!(taskId) : undefined
    if (feedbackComponent.value) {
      if ((await feedbackComponent.value.prepareDismiss(completed, close)) === false) return
    } else await close?.()
    if (props.task?.taskId !== taskId || stoppable.value || dismissBlocked.value) return
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Could not close this review.')
    return
  } finally {
    if (props.task?.taskId === taskId) finishing.value = false
  }
  const finish = () => {
    dismissed.value = true
    exitPhase.value = null
    emit('done', taskId)
  }
  if (!visible.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish()
    return
  }
  exitPhase.value = 'collapsing'
  exitTimer = setTimeout(() => {
    exitPhase.value = 'exiting'
    exitTimer = setTimeout(finish, 260)
  }, 460)
}

watch(
  () => [props.task?.taskId, props.task?.target.sessionId, props.anchor] as const,
  ([taskId, sessionId, anchor], previous) => {
    if (taskId !== previous?.[0] || sessionId !== previous?.[1]) {
      clearTimeout(exitTimer)
      exitPhase.value = null
      dismissed.value = false
      finishing.value = false
      retainedAnchor.value = null
    }
    if (anchor) retainedAnchor.value = anchor
  },
  { immediate: true }
)

const active = computed(() => props.task?.status === 'active' || props.task?.status === 'stopping')
const local = computed(() => props.restored || props.task?.target.sessionId === props.sessionId)
const taskAnchor = computed(() => props.anchor ?? retainedAnchor.value)
const hasAnchor = shallowRef(false)
const visible = computed(
  () =>
    !!props.task &&
    !dismissed.value &&
    sameFile.value &&
    (active.value || (local.value && (props.task.status !== 'cancelled' || hasAnchor.value)))
)
const executing = computed(() => active.value && !!props.task?.operation)
const canLocate = computed(() => visible.value && local.value && hasAnchor.value)
function locate() {
  if (!canLocate.value) return
  const anchor = taskAnchor.value
  if (!anchor || anchor.removed) return
  const page = getContainingPage(anchor)
  if (!page) return
  window.figma.currentPage = page
  const viewport = window.figma.viewport
  viewport.scrollAndZoomIntoView([anchor])
  const bounds = anchor.absoluteBoundingBox
  const canvas = getCanvas()?.getBoundingClientRect()
  if (!bounds || !canvas?.width || !canvas.height) return
  const style = toolbar.value && getComputedStyle(toolbar.value)
  const barWidth = parseFloat(style?.getPropertyValue('--tp-toolbar-width') ?? '') || 360
  const barHeight = parseFloat(style?.height ?? '') || 36
  const width = canvas.width - 16,
    height = canvas.height - 16
  // Fit every opposite edge pair: the design scales, while the bar stays in screen pixels.
  const fit = (pixels: number, units: number) =>
    units > 0 ? Math.max(1, pixels) / units : Infinity
  const zoom = Math.min(
    viewport.zoom,
    fit(width, bounds.width),
    fit(width, bounds.width - offset.x),
    fit(width - barWidth, offset.x),
    fit(height, bounds.height),
    fit(height - toolbarOffset, bounds.height - offset.y),
    fit(height + toolbarOffset - barHeight, offset.y)
  )
  const left = Math.min(0, offset.x * zoom)
  const right = Math.max(bounds.width * zoom, offset.x * zoom + barWidth)
  const top = Math.min(0, offset.y * zoom - toolbarOffset)
  const bottom = Math.max(bounds.height * zoom, offset.y * zoom - toolbarOffset + barHeight)
  viewport.zoom = zoom
  viewport.center = {
    x: bounds.x + (left + right) / (2 * zoom),
    y: bounds.y + (top + bottom) / (2 * zoom)
  }
}

const label = computed(() => {
  const name = props.task?.client?.name || 'The agent'
  if (props.task?.status === 'cancelled') return `${name}'s design task has stopped`
  if (props.task?.status === 'stopping') return `${name}'s design task is stopping…`
  if (props.task?.status === 'completed') return `${name} finished the design task`
  if (props.task && ['paused', 'expired', 'interrupted'].includes(props.task.status))
    return `${name}'s design task is paused`
  if (!local.value) return `${name} is working in another tab`
  if (props.task?.operation === 'writing') return `${name} is updating the design`
  if (props.task?.operation === 'reading') return `${name} is reviewing the design`
  return `${name} is working on the design`
})

const panelDesigning = computed(() => props.task?.status === 'active' && local.value)
const panelLabel = computed(() =>
  panelDesigning.value ? `${props.task?.client?.name || 'The agent'} is designing` : label.value
)

onMounted(() => {
  watch(
    [() => props.task, dismissBlocked],
    async () => {
      // Let the feedback child report restored drafts and pending edits before closing.
      await nextTick()
      if (props.task?.status === 'cancelled' && local.value && !dismissed.value) void done()
    },
    { immediate: true, flush: 'post' }
  )
})

const projection = shallowRef<{
  clip: ReturnType<typeof canvasClipStyle>
  anchor: { transform: string; width: string; height: string }
  feedback: { left: string; top: string }
} | null>(null)
let stopObserving: (() => void) | undefined
let previous = ''
let lastFrame: CanvasOverlayFrame | null = null
const positionStorageKey = 'tempad-dev:design-status-position'
const positionKey = computed(() =>
  props.task && taskAnchor.value
    ? JSON.stringify([props.task.target.fileKey, props.task.taskId, taskAnchor.value.id])
    : null
)
let offset = { x: 0, y: 0 }
let drag: {
  pointerId: number
  element: HTMLElement
  grabX: number
  grabY: number
  initial: { x: number; y: number }
} | null = null

function savePosition() {
  if (!positionKey.value) return
  try {
    window.sessionStorage.setItem(
      positionStorageKey,
      JSON.stringify({ key: positionKey.value, ...offset })
    )
  } catch {
    // Moving the bar still works when tab storage is unavailable.
  }
}

function finishDrag(commit: boolean) {
  const current = drag
  if (!current) return
  drag = null
  if (current.element.hasPointerCapture(current.pointerId))
    current.element.releasePointerCapture(current.pointerId)
  if (commit) savePosition()
  else offset = current.initial
  updateProjection(lastFrame)
}

function endDrag(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) finishDrag(event.type === 'pointerup')
}

function isBarSurface(event: Event): boolean {
  return event.target instanceof Element && !event.target.closest('button, a, input, textarea')
}

function startDrag(event: PointerEvent) {
  if (
    !projection.value ||
    exitPhase.value ||
    event.button !== 0 ||
    !event.isPrimary ||
    !isBarSurface(event) ||
    drag
  )
    return
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  event.preventDefault()
  event.stopPropagation()
  element.setPointerCapture(event.pointerId)
  drag = {
    pointerId: event.pointerId,
    element,
    grabX: event.clientX - rect.left,
    grabY: event.clientY - rect.top,
    initial: offset
  }
}

function moveDrag(event: PointerEvent) {
  const current = drag
  const frame = lastFrame
  const projected = projection.value
  if (!current || event.pointerId !== current.pointerId || !frame || !projected) return
  event.preventDefault()
  event.stopPropagation()
  if (event.buttons === 0) return finishDrag(true)
  const element = current.element
  const originX = parseFloat(projected.feedback.left) - offset.x * frame.zoom
  const originY = parseFloat(projected.feedback.top) - offset.y * frame.zoom
  // Clamp only the drag gesture; normal pan/zoom still follows the design anchor.
  const width = parseFloat(getComputedStyle(element).getPropertyValue('--tp-toolbar-width'))
  const left = Math.max(
    8,
    Math.min(
      event.clientX - frame.canvas.left - current.grabX,
      Math.max(8, frame.canvas.width - width - 8)
    )
  )
  const top = Math.max(
    8,
    Math.min(
      event.clientY - frame.canvas.top - current.grabY,
      Math.max(8, frame.canvas.height - element.offsetHeight - 8)
    )
  )
  offset = { x: (left - originX) / frame.zoom, y: (top - originY) / frame.zoom }
  updateProjection(frame)
}

function resetPosition(event: Event) {
  if (!projection.value || exitPhase.value || !isBarSurface(event)) return
  event.preventDefault()
  event.stopPropagation()
  finishDrag(false)
  offset = { x: 0, y: 0 }
  savePosition()
  updateProjection(lastFrame)
}

useEventListener(
  window,
  'keydown',
  (event) => {
    if (event.key !== 'Escape' || !drag) return
    event.preventDefault()
    event.stopPropagation()
    finishDrag(false)
  },
  { capture: true }
)
useEventListener(window, 'blur', () => finishDrag(false))

function updateProjection(frame: CanvasOverlayFrame | null) {
  lastFrame = frame
  currentFileKey.value = frame?.fileKey ?? null
  const anchor = taskAnchor.value
  let pageId: string | undefined
  let projected: ReturnType<typeof projectCanvasAnchor> = null
  try {
    if (anchor && !anchor.removed && frame) {
      pageId = getContainingPage(anchor)?.id
      const bounds = anchor.absoluteBoundingBox
      if (pageId && bounds) projected = projectCanvasAnchor(bounds, frame.bounds, frame.zoom)
    }
  } catch {
    // Native nodes may disappear while the task is still running.
  }
  hasAnchor.value = !!projected
  const next =
    visible.value && local.value && frame && projected && pageId === frame.pageId
      ? {
          clip: canvasClipStyle(frame.canvas),
          feedback: {
            left: `${projected.x + offset.x * frame.zoom}px`,
            top: `${projected.y - toolbarOffset + offset.y * frame.zoom}px`
          },
          anchor: {
            transform: `translate(${projected.x}px, ${projected.y}px)`,
            width: `${projected.width}px`,
            height: `${projected.height}px`
          }
        }
      : null
  if (!next && drag) finishDrag(false)
  const serialized = JSON.stringify(next)
  if (serialized !== previous) {
    previous = serialized
    projection.value = next
  }
}

watch(
  positionKey,
  (key) => {
    finishDrag(false)
    offset = { x: 0, y: 0 }
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(positionStorageKey) ?? 'null')
      if (key && saved?.key === key && Number.isFinite(saved.x) && Number.isFinite(saved.y))
        offset = { x: saved.x, y: saved.y }
    } catch {
      // Ignore an unavailable or malformed saved position.
    }
    updateProjection(lastFrame)
  },
  { immediate: true }
)
watch(exitPhase, (phase) => {
  if (phase) finishDrag(false)
})

watch(
  () => [dismissed.value, local.value, active.value, taskAnchor.value, props.task?.taskId],
  () => {
    stopObserving?.()
    stopObserving = undefined
    previous = ''
    // Observe independently of visibility so an unavailable anchor can recover.
    if (!dismissed.value && local.value && (active.value || taskAnchor.value)) {
      stopObserving = observeCanvasOverlay(updateProjection)
    } else {
      hasAnchor.value = false
      projection.value = null
    }
  },
  { immediate: true }
)
onScopeDispose(() => {
  finishDrag(false)
  stopObserving?.()
  clearTimeout(exitTimer)
})
</script>

<template>
  <Section class="tp-design-task-section" flat :collapsed="!visible || !!exitPhase">
    <div class="tp-design-panel-status">
      <button
        v-if="task"
        type="button"
        class="tp-design-locate"
        :data-tooltip="canLocate ? `${task.title} · Click to locate` : task.title"
        data-tooltip-type="text"
        :aria-label="!canLocate ? panelLabel : 'Locate agent status on canvas'"
        :disabled="!canLocate"
        @click.stop="locate"
      >
        <span :class="{ 'tp-design-shimmer': panelDesigning }">{{ panelLabel }}</span>
      </button>
      <div ref="panelControls" class="tp-design-panel-actions" />
    </div>
  </Section>
  <Teleport :to="hasAnchor || !panelControls ? 'tempad' : panelControls">
    <div
      v-if="task && local && !dismissed"
      v-show="visible && (hasAnchor ? projection : !!panelControls)"
      :class="hasAnchor ? 'tp-design-overlay' : 'tp-design-panel-controls'"
      :style="hasAnchor ? projection?.clip : undefined"
    >
      <div
        v-if="active && projection?.anchor"
        class="tp-design-anchor"
        :class="{ 'tp-design-anchor-working': executing }"
        :style="projection.anchor"
        aria-hidden="true"
      />
      <div
        ref="toolbar"
        class="tp-design-feedback"
        :class="{
          'tp-design-anchored': hasAnchor,
          'tp-design-leaving': !!exitPhase,
          'tp-design-collapsing': exitPhase === 'collapsing',
          'tp-design-exiting': exitPhase === 'exiting'
        }"
        :style="projection?.feedback"
        role="status"
        aria-live="polite"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
        @dblclick="resetPosition"
      >
        <TemPadLogo
          v-if="hasAnchor"
          class="tp-design-logo"
          :loading="active && hasAnchor"
          aria-hidden="true"
        />
        <div class="tp-design-feedback-content" :inert="!!exitPhase">
          <span v-if="hasAnchor" class="tp-design-anchor-label">
            <span class="tp-design-label-text" :class="{ 'tp-design-shimmer': active }">{{
              label
            }}</span>
          </span>
          <DesignTaskFeedback
            v-if="!exitPhase && feedbackSupported"
            ref="feedbackComponent"
            :canvas-enabled="visible && hasAnchor"
            :task="task"
            :session-id="sessionId"
            :restored="restored"
            :send-feedback="sendFeedback"
            :request-drafts="requestDrafts"
            :action-result="actionResult"
            @dismiss-blocked="dismissBlocked = $event"
          />
          <Button
            v-if="stoppable"
            class="tp-design-stop"
            :aria-label="task.status === 'stopping' ? 'Stopping design task' : 'Stop design task'"
            data-tooltip="Stop design task"
            data-tooltip-type="text"
            :disabled="task.status === 'stopping'"
            @pointerdown.stop
            @click.stop="emit('stop')"
          >
            Stop
          </Button>
          <Button
            v-else-if="task.status === 'completed'"
            class="tp-design-done"
            :disabled="dismissBlocked || finishing || !!exitPhase"
            :data-tooltip="
              dismissBlocked ? 'Wait for comments to finish' : 'Finish task and clear comments'
            "
            data-tooltip-type="text"
            @pointerdown.stop
            @click.stop="done"
            >Done</Button
          >
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tp-design-task-section :deep(.tp-section-content) {
  padding: 0;
}
.tp-design-task-section.tp-section-leave-active {
  pointer-events: none;
}
.tp-design-panel-status {
  display: flex;
  align-items: center;
  gap: var(--spacer-2, 8px);
  min-height: 40px;
  padding: var(--spacer-2, 8px) var(--spacer-3, 16px);
}
.tp-design-panel-actions {
  margin-left: auto;
}
.tp-design-locate {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
  margin: 0 -4px;
  padding: 0 4px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  text-align: left;
  cursor: default;
}
.tp-design-locate > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tp-design-locate:hover:not(:disabled) {
  background: var(--color-bg-hover);
}
.tp-design-locate:focus-visible {
  outline: 1px solid var(--color-border-selected);
  outline-offset: -1px;
}
.tp-design-panel-controls {
  margin-left: auto;
}
.tp-design-panel-controls .tp-design-feedback {
  position: static;
  width: auto;
  height: auto;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: visible;
}
.tp-design-panel-controls .tp-design-feedback-content {
  width: auto;
}
.tp-design-overlay {
  position: fixed;
  overflow: hidden;
  pointer-events: none;
  z-index: 5;
}
.tp-design-anchor {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  border: 1px solid var(--color-border-selected, #0d99ff);
  opacity: 0.45;
  border-radius: 4px;
  background: transparent;
}
.tp-design-anchor-working {
  opacity: 1;
}
.tp-design-feedback {
  --tp-toolbar-width: 360px;
  position: absolute;
  box-sizing: border-box;
  width: var(--tp-toolbar-width, 360px);
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px;
  overflow: hidden;
  transform-origin: 18px 18px;
  border: 1px solid var(--color-border, light-dark(#e6e6e6, #444));
  border-radius: calc(var(--radius-medium, 4px) + 5px);
  background: var(--color-bg, light-dark(#fff, #2c2c2c));
  color: var(--color-text, light-dark(#333, #fff));
  font: 11px/16px var(--font-family-ui, Inter, sans-serif);
  pointer-events: auto;
}
.tp-design-anchored {
  cursor: default;
  touch-action: none;
  user-select: none;
  animation:
    tp-design-logo-in 260ms ease-out both,
    tp-design-expand 460ms 260ms ease-out both;
}
.tp-design-anchored .tp-design-feedback-content {
  animation: tp-design-content-in 180ms 440ms ease-out both;
}
.tp-design-logo {
  display: flex;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin: 0 2px;
}
.tp-design-feedback-content {
  display: flex;
  align-items: center;
  gap: 5px;
  width: calc(var(--tp-toolbar-width, 360px) - 44px);
  flex-shrink: 0;
}
.tp-design-anchor-label {
  flex: 1;
  min-width: 0;
  color: inherit;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}
.tp-design-label-text {
  display: block;
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.tp-design-stop,
.tp-design-done {
  height: 24px;
  padding: 0 8px;
  flex: none;
}
.tp-design-leaving {
  pointer-events: none;
}
.tp-design-collapsing {
  animation: tp-design-collapse 460ms cubic-bezier(0.22, 0.8, 0.25, 1) forwards;
}
.tp-design-collapsing .tp-design-feedback-content {
  animation: tp-design-content-out 180ms ease-out forwards;
}
.tp-design-exiting {
  width: 36px;
  animation: tp-design-logo-out 260ms cubic-bezier(0.22, 0.6, 0.35, 1) forwards;
}
.tp-design-exiting .tp-design-feedback-content {
  opacity: 0;
}
@keyframes tp-design-logo-in {
  from {
    width: 36px;
    transform: scale(0.78);
    opacity: 0;
  }
  to {
    width: 36px;
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes tp-design-expand {
  0% {
    width: 36px;
  }
  72% {
    width: var(--tp-toolbar-width, 360px);
  }
  88% {
    width: calc(var(--tp-toolbar-width, 360px) - 3px);
  }
  100% {
    width: var(--tp-toolbar-width, 360px);
  }
}
@keyframes tp-design-content-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.tp-design-shimmer {
  color: transparent;
  background-color: var(--color-text, #222);
  background-image: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-text, #222) 50%, white) 25%,
    color-mix(in srgb, var(--color-text, #222) 15%, white) 45%,
    color-mix(in srgb, var(--color-text, #222) 15%, white) 55%,
    color-mix(in srgb, var(--color-text, #222) 50%, white) 75%,
    transparent
  );
  background-position: 250% 0;
  background-repeat: no-repeat;
  background-size: 180% 100%;
  background-clip: text;
  animation: tp-design-shimmer 2.8s linear infinite;
}
@keyframes tp-design-shimmer {
  to {
    background-position: -150% 0;
  }
}
@keyframes tp-design-collapse {
  0% {
    width: var(--tp-toolbar-width, 360px);
  }
  72% {
    width: 36px;
  }
  88% {
    width: 39px;
  }
  100% {
    width: 36px;
  }
}
@keyframes tp-design-content-out {
  to {
    opacity: 0;
  }
}
@keyframes tp-design-logo-out {
  from {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(0.78);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tp-design-task-section {
    transition: none;
  }
  .tp-design-feedback,
  .tp-design-feedback-content,
  .tp-design-shimmer,
  .tp-design-collapsing .tp-design-feedback-content {
    animation: none;
  }
  .tp-design-shimmer {
    color: inherit;
    background: none;
  }
  .tp-design-collapsing {
    width: 36px;
  }
  .tp-design-collapsing .tp-design-feedback-content {
    opacity: 0;
  }
}
</style>
