<script setup lang="ts">
import { ArrowLeft, ArrowRight, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { setPageScrollLocked } from '@/composables/scrollbar'
import { useSiteColorMode } from '@/composables/useSiteColorMode'
import { INSPECTION_SLIDES } from '@/content/landing'

const activeIndex = ref(0)
const viewer = ref<HTMLDialogElement>()
const imageTrigger = ref<HTMLButtonElement>()
const viewerMedia = ref<HTMLDivElement>()
const zoomed = ref(false)
const { resolvedColorMode } = useSiteColorMode()
const activeSlide = computed(() => INSPECTION_SLIDES[activeIndex.value]!)
const position = computed(() => String(activeIndex.value + 1).padStart(2, '0'))
let touchStart: { x: number; y: number } | undefined
let lastSwipeTime = -Infinity
let savedOverflow = ''

function move(direction: -1 | 1): void {
  activeIndex.value =
    (activeIndex.value + direction + INSPECTION_SLIDES.length) % INSPECTION_SLIDES.length
}

function handleKeys(event: KeyboardEvent): void {
  if (zoomed.value && event.target === viewerMedia.value) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    move(event.key === 'ArrowLeft' ? -1 : 1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    activeIndex.value = event.key === 'Home' ? 0 : INSPECTION_SLIDES.length - 1
  }
}

function handleTouchStart(event: TouchEvent): void {
  const touch = event.touches[0]
  touchStart =
    touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : undefined
}

function handleTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  if (touchStart && touch) {
    const dx = touch.clientX - touchStart.x
    const dy = touch.clientY - touchStart.y
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      move(dx < 0 ? 1 : -1)
      lastSwipeTime = performance.now()
    }
  }
  touchStart = undefined
}

function openViewer(): void {
  if (performance.now() - lastSwipeTime < 400) return
  zoomed.value = false
  savedOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  setPageScrollLocked(true)
  viewer.value?.showModal()
}

function closeViewer(): void {
  viewer.value?.close()
}

async function toggleZoom(): Promise<void> {
  zoomed.value = !zoomed.value
  await nextTick()
  const media = viewerMedia.value
  if (media) {
    media.scrollTo({ left: zoomed.value ? (media.scrollWidth - media.clientWidth) / 2 : 0, top: 0 })
    if (zoomed.value) media.focus({ preventScroll: true })
  }
}

function restoreViewer(): void {
  document.body.style.overflow = savedOverflow
  setPageScrollLocked(false)
  imageTrigger.value?.focus({ preventScroll: true })
}

watch(
  [activeIndex, resolvedColorMode],
  () => {
    for (const offset of [-1, 1]) {
      const slide =
        INSPECTION_SLIDES[
          (activeIndex.value + offset + INSPECTION_SLIDES.length) % INSPECTION_SLIDES.length
        ]!
      const image = new Image()
      image.src = slide.image[resolvedColorMode.value]
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (viewer.value?.open) {
    document.body.style.overflow = savedOverflow
    setPageScrollLocked(false)
  }
})
</script>

<template>
  <figure
    class="site-inspection-gallery"
    aria-label="Inspection examples"
    aria-roledescription="carousel"
    @keydown="handleKeys"
  >
    <div
      class="site-inspection-preview"
      @touchstart.passive="handleTouchStart"
      @touchend.passive="handleTouchEnd"
    >
      <button
        ref="imageTrigger"
        type="button"
        class="site-inspection-image"
        :aria-label="`Enlarge ${activeSlide.caption}`"
        aria-haspopup="dialog"
        @click="openViewer"
      >
        <img
          :key="activeSlide.id"
          :src="activeSlide.image[resolvedColorMode]"
          :alt="activeSlide.image.alt"
          :width="activeSlide.image.width"
          :height="activeSlide.image.height"
          loading="lazy"
        />
        <span class="site-inspection-expand" aria-hidden="true"><Maximize2 :size="15" /></span>
      </button>
    </div>
    <figcaption class="site-inspection-bar">
      <span class="site-inspection-caption" aria-live="polite" aria-atomic="true">
        {{ activeSlide.caption
        }}<span class="site-sr-only"
          >, {{ activeIndex + 1 }} of {{ INSPECTION_SLIDES.length }}</span
        >
      </span>
      <div class="site-inspection-controls">
        <span class="site-inspection-count" aria-hidden="true"
          >{{ position
          }}<span> / {{ INSPECTION_SLIDES.length.toString().padStart(2, '0') }}</span></span
        >
        <button
          type="button"
          aria-label="Previous example"
          title="Previous example"
          @click="move(-1)"
        >
          <ArrowLeft />
        </button>
        <button type="button" aria-label="Next example" title="Next example" @click="move(1)">
          <ArrowRight />
        </button>
      </div>
    </figcaption>
    <Teleport to="body">
      <dialog
        ref="viewer"
        class="site-image-viewer"
        aria-labelledby="image-viewer-title"
        @keydown="handleKeys"
        @close="restoreViewer"
        @click="
          (event) => {
            if (event.target === viewer) closeViewer()
          }
        "
      >
        <div class="site-image-viewer-sheet">
          <header class="site-image-viewer-header">
            <span id="image-viewer-title" aria-live="polite">{{ activeSlide.caption }}</span>
            <div class="site-inspection-controls">
              <span class="site-inspection-count" aria-hidden="true"
                >{{ position }} / {{ INSPECTION_SLIDES.length.toString().padStart(2, '0') }}</span
              >
              <button type="button" aria-label="Previous example" @click="move(-1)">
                <ArrowLeft />
              </button>
              <button type="button" aria-label="Next example" @click="move(1)">
                <ArrowRight />
              </button>
              <button
                type="button"
                :aria-label="zoomed ? 'Fit image' : 'Zoom image'"
                :title="zoomed ? 'Fit image' : 'Zoom image'"
                @click="toggleZoom"
              >
                <ZoomOut v-if="zoomed" /><ZoomIn v-else />
              </button>
              <button type="button" aria-label="Close image" autofocus @click="closeViewer">
                <X />
              </button>
            </div>
          </header>
          <div
            ref="viewerMedia"
            class="site-image-viewer-media"
            :class="{ 'is-zoomed': zoomed }"
            :tabindex="zoomed ? 0 : undefined"
            :aria-label="zoomed ? 'Full-size screenshot. Scroll to explore.' : undefined"
            @touchstart.passive="
              (event) => {
                if (!zoomed) handleTouchStart(event)
              }
            "
            @touchend.passive="
              (event) => {
                if (!zoomed) handleTouchEnd(event)
              }
            "
          >
            <img
              :src="activeSlide.image[resolvedColorMode]"
              :alt="activeSlide.image.alt"
              :width="activeSlide.image.width"
              :height="activeSlide.image.height"
            />
          </div>
          <a
            class="site-image-original"
            :href="activeSlide.image[resolvedColorMode]"
            target="_blank"
            rel="noopener"
            >Open original <Maximize2 :size="13" aria-hidden="true"
          /></a>
        </div>
      </dialog>
    </Teleport>
  </figure>
</template>

<style scoped>
.site-inspection-gallery {
  min-width: 0;
  margin: 0;
}
.site-inspection-preview {
  overflow: hidden;
  border: 1px solid var(--site-line);
  border-radius: 10px;
  background: var(--site-panel);
}
.site-inspection-image {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--site-ink);
  cursor: zoom-in;
}
.site-inspection-image img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 2;
  animation: image-reveal 180ms ease-out;
}
.site-inspection-image:focus-visible {
  outline-offset: -4px;
}
.site-inspection-expand {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--site-panel);
  border: 1px solid var(--site-line);
  color: var(--site-text-muted);
  transition:
    color 160ms ease,
    border-color 160ms ease;
}
.site-inspection-image:hover .site-inspection-expand {
  color: var(--site-ink);
  border-color: var(--site-text-soft);
}
.site-inspection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0 0;
}
.site-inspection-caption {
  color: var(--site-text);
  font-size: 13px;
  font-weight: 500;
}
.site-inspection-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.site-inspection-count {
  margin-right: 6px;
  padding-right: 14px;
  border-right: 1px solid var(--site-line);
  color: var(--site-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.site-inspection-count > span {
  color: var(--site-text-soft);
}
.site-inspection-controls button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--site-text-muted);
  background: transparent;
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.site-inspection-controls button:hover {
  background: var(--site-toggle-button-hover);
  color: var(--site-ink);
}
.site-inspection-controls svg {
  width: 17px;
  height: 17px;
  stroke-width: 1.5;
}
.site-image-viewer {
  max-width: none;
  max-height: none;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 24px;
  border: 0;
  background: transparent;
  color: var(--site-text);
}
.site-image-viewer[open] {
  display: grid;
  place-items: center;
}
.site-image-viewer::backdrop {
  background: rgb(8 12 20 / 65%);
  backdrop-filter: blur(8px);
}
.site-image-viewer-sheet {
  width: min(1120px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 8px 20px 12px;
  background: var(--site-bg);
  border: 1px solid var(--site-line);
  border-radius: 12px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 16%);
}
.site-image-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
}
.site-image-viewer-media img {
  display: block;
  width: 100%;
  height: auto;
  max-height: calc(100dvh - 180px);
  object-fit: contain;
}
.site-image-viewer-media.is-zoomed {
  max-height: calc(100dvh - 220px);
  overflow: auto;
  overscroll-behavior: contain;
}
.site-image-viewer-media.is-zoomed img {
  width: clamp(720px, 150%, 1440px);
  max-width: none;
  max-height: none;
}
.site-image-original {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  color: var(--site-text-muted);
  font-size: 12px;
}
@keyframes image-reveal {
  from {
    opacity: 0.65;
  }
  to {
    opacity: 1;
  }
}
@media (max-width: 640px) {
  .site-inspection-controls button {
    width: 44px;
    height: 44px;
  }
  .site-inspection-count {
    margin-right: 6px;
  }
  .site-image-viewer {
    padding: 12px;
  }
  .site-image-viewer-sheet {
    padding-inline: 12px;
  }
  .site-image-viewer-header {
    flex-wrap: wrap;
    padding-bottom: 8px;
  }
  .site-image-viewer-header .site-inspection-count {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .site-inspection-image img {
    animation: none;
  }
}
</style>
