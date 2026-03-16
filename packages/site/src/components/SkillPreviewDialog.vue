<script setup lang="ts">
import { ChevronDown, X } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import skillPreviewMeta from '../../../../skill/SKILL.md?skill-preview'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
const mobileCloseButtonRef = ref<HTMLButtonElement | null>(null)
const articleRef = ref<HTMLElement | null>(null)
const isSidebarOpen = ref(false)

let previousFocusTarget: HTMLElement | null = null
const hasSidebar = skillPreviewMeta.metadataEntries.length > 0 || skillPreviewMeta.toc.length > 0
const mobileToggleText = skillPreviewMeta.toc.length > 0 ? 'Jump to section' : 'Skill details'

watch(
  [() => props.open, dialogRef],
  async ([open, dialog]) => {
    if (!dialog) {
      return
    }

    if (open) {
      lockRootScroll()
      isSidebarOpen.value = false
      previousFocusTarget =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      if (!dialog.open) {
        dialog.showModal()
      }

      await nextTick()
      const isCompactLayout =
        typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches

      if (isCompactLayout) {
        mobileCloseButtonRef.value?.focus()
      } else {
        closeButtonRef.value?.focus()
      }

      return
    }

    unlockRootScroll()
    isSidebarOpen.value = false

    if (dialog.open) {
      dialog.close()
    }

    restorePreviousFocus()
  },
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  unlockRootScroll()
  restorePreviousFocus()

  if (dialogRef.value?.open) {
    dialogRef.value.close()
  }
})

let previousRootOverflow = ''

function lockRootScroll(): void {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement

  if (root.style.overflow === 'hidden') {
    return
  }

  previousRootOverflow = root.style.overflow
  root.style.overflow = 'hidden'
}

function unlockRootScroll(): void {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.style.overflow = previousRootOverflow
}

function restorePreviousFocus(): void {
  if (previousFocusTarget?.isConnected) {
    previousFocusTarget.focus()
  }

  previousFocusTarget = null
}

function requestClose(): void {
  emit('close')
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === dialogRef.value) {
    requestClose()
  }
}

function handleCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

function handleTocClick(id: string, event: MouseEvent): void {
  event.preventDefault()

  const target = articleRef.value?.querySelector<HTMLElement>(`[id="${id}"]`)

  if (!target) {
    return
  }

  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  target.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion ? 'auto' : 'smooth'
  })

  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
    isSidebarOpen.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="site-skill-dialog"
      aria-label="Skill preview"
      @cancel="handleCancel"
      @click="handleBackdropClick"
    >
      <div class="site-skill-dialog-shell">
        <button
          ref="closeButtonRef"
          type="button"
          class="site-client-icon-button site-skill-dialog-close"
          aria-label="Close skill preview"
          @click="requestClose"
        >
          <X aria-hidden="true" />
        </button>

        <div
          class="site-skill-dialog-body"
          :class="{ 'has-sidebar': hasSidebar, 'is-sidebar-open': isSidebarOpen }"
        >
          <div class="site-skill-dialog-mobile-bar">
            <button
              v-if="hasSidebar"
              type="button"
              class="site-skill-dialog-mobile-toggle"
              :aria-expanded="isSidebarOpen"
              aria-controls="skill-preview-sidebar"
              @click="isSidebarOpen = !isSidebarOpen"
            >
              <span class="site-skill-dialog-mobile-toggle-text">{{ mobileToggleText }}</span>
              <ChevronDown aria-hidden="true" class="site-skill-dialog-mobile-toggle-icon" />
            </button>

            <button
              ref="mobileCloseButtonRef"
              type="button"
              class="site-client-icon-button site-skill-dialog-close site-skill-dialog-close-mobile"
              aria-label="Close skill preview"
              @click="requestClose"
            >
              <X aria-hidden="true" />
            </button>
          </div>

          <article ref="articleRef" class="site-skill-prose">
            <div class="site-skill-prose-inner" v-html="skillPreviewMeta.html" />
          </article>

          <div v-if="hasSidebar" class="site-skill-dialog-sidebar-shell">
            <aside id="skill-preview-sidebar" class="site-skill-dialog-sidebar">
              <nav
                v-if="skillPreviewMeta.toc.length"
                class="site-skill-dialog-sidebar-section site-skill-dialog-toc"
                aria-label="Table of contents"
              >
                <p class="site-skill-dialog-sidebar-label">Contents</p>
                <ol class="site-skill-dialog-toc-list">
                  <li
                    v-for="entry in skillPreviewMeta.toc"
                    :key="entry.id"
                    class="site-skill-dialog-toc-item"
                  >
                    <a
                      :href="`#${entry.id}`"
                      class="site-skill-dialog-toc-link"
                      @click="handleTocClick(entry.id, $event)"
                    >
                      {{ entry.text }}
                    </a>
                  </li>
                </ol>
              </nav>

              <section
                v-if="skillPreviewMeta.metadataEntries.length"
                class="site-skill-dialog-sidebar-section"
                aria-label="Metadata"
              >
                <dl class="site-skill-dialog-meta">
                  <div
                    v-for="entry in skillPreviewMeta.metadataEntries"
                    :key="entry.key"
                    class="site-skill-dialog-meta-row"
                  >
                    <dt>{{ entry.key }}</dt>
                    <dd>{{ entry.value }}</dd>
                  </div>
                </dl>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.site-skill-dialog {
  width: min(1160px, calc(100vw - 28px));
  max-width: none;
  height: min(88vh, 860px);
  padding: 0;
  border: none;
  overflow: hidden;
  border-radius: 12px;
  background: transparent;
  color: var(--site-text);
}

.site-skill-dialog::backdrop {
  background: rgb(15 23 42 / 16%);
  backdrop-filter: blur(2px);
}

.site-skill-dialog-shell {
  position: relative;
  display: grid;
  height: 100%;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--site-line) 100%, transparent);
  border-radius: inherit;
  background: color-mix(in srgb, var(--site-panel) 99%, transparent);
  box-shadow:
    0 14px 32px rgb(15 23 42 / 8%),
    0 1px 4px rgb(15 23 42 / 5%);
}

html.dark .site-skill-dialog-shell {
  background: color-mix(in srgb, var(--site-panel) 99%, transparent);
  box-shadow:
    0 16px 36px rgb(0 0 0 / 22%),
    0 1px 6px rgb(0 0 0 / 18%);
}

.site-skill-dialog-close svg {
  width: 15px;
  height: 15px;
  flex: none;
}

.site-skill-dialog-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
  width: 36px;
  height: 36px;
}

.site-skill-dialog-close-mobile {
  display: none;
}

.site-skill-dialog-close:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--site-accent) 36%, var(--site-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-accent) 18%, transparent);
}

.site-skill-dialog-body {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-areas: 'content';
  min-height: 0;
  overflow: hidden;
  border-radius: inherit;
}

.site-skill-dialog-body.has-sidebar {
  grid-template-columns: minmax(0, 1fr) minmax(244px, 272px);
  grid-template-areas: 'content sidebar';
}

.site-skill-dialog-mobile-bar {
  display: none;
}

.site-skill-dialog-mobile-toggle {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--site-line) 88%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--site-surface) 80%, transparent);
  color: var(--site-text);
  text-align: left;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease;
}

.site-skill-dialog-mobile-toggle:hover {
  border-color: color-mix(in srgb, var(--site-line) 62%, transparent);
  background: color-mix(in srgb, var(--site-toggle-button-hover) 92%, transparent);
}

.site-skill-dialog-mobile-toggle:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--site-accent) 36%, var(--site-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-accent) 14%, transparent);
}

.site-skill-dialog-mobile-toggle-text {
  overflow: hidden;
  font-size: 0.84rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-skill-dialog-mobile-toggle-icon {
  margin-left: auto;
  width: 16px;
  height: 16px;
  color: var(--site-text-soft);
  transition: transform 180ms ease;
}

.site-skill-dialog-body.is-sidebar-open .site-skill-dialog-mobile-toggle-icon {
  transform: rotate(180deg);
}

.site-skill-dialog-sidebar-shell {
  grid-area: sidebar;
  min-height: 0;
  overflow: hidden;
  border-bottom-right-radius: inherit;
}

.site-skill-dialog-sidebar {
  grid-area: sidebar;
  display: grid;
  align-content: start;
  gap: 18px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  padding: 56px 24px 24px 20px;
  border-left: 1px solid color-mix(in srgb, var(--site-line) 88%, transparent);
  background: color-mix(in srgb, var(--site-surface) 54%, transparent);
  border-bottom-right-radius: inherit;
}

html.dark .site-skill-dialog-sidebar {
  background: color-mix(in srgb, var(--site-surface) 48%, transparent);
}

.site-skill-dialog-sidebar-section {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.site-skill-dialog-sidebar-section + .site-skill-dialog-sidebar-section {
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--site-line) 72%, transparent);
}

.site-skill-dialog-sidebar-label {
  margin: 0;
  color: var(--site-text-soft);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.site-skill-dialog-meta {
  display: grid;
  gap: 0;
  margin: 0;
}

.site-skill-dialog-meta-row {
  display: grid;
  gap: 6px;
  padding: 12px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--site-line) 72%, transparent);
}

.site-skill-dialog-meta-row:first-child {
  padding-top: 0;
}

.site-skill-dialog-meta-row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.site-skill-dialog-meta-row dt {
  color: var(--site-text-soft);
  font-family: var(--site-font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.site-skill-dialog-meta-row dd {
  margin: 0;
  color: var(--site-text);
  font-size: 0.78rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.site-skill-dialog-toc-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-skill-dialog-toc-link {
  position: relative;
  display: block;
  padding: 6px 8px 6px 12px;
  border-radius: 7px;
  color: var(--site-text-muted);
  font-size: 0.78rem;
  line-height: 1.28;
  text-decoration: none;
  overflow-wrap: anywhere;
  transition:
    color 160ms ease,
    background 160ms ease;
}

.site-skill-dialog-toc-link:hover {
  color: var(--site-ink);
  background: color-mix(in srgb, var(--site-toggle-button-hover) 92%, transparent);
}

.site-skill-dialog-toc-link:focus-visible {
  outline: none;
  color: var(--site-ink);
  background: color-mix(in srgb, var(--site-toggle-button-hover) 92%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-accent) 14%, transparent);
}

.site-skill-prose {
  grid-area: content;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  display: grid;
  justify-items: start;
  padding: 56px clamp(24px, 4vw, 42px) 40px;
  overscroll-behavior: contain;
  color: var(--site-text);
  font-size: 0.95rem;
  line-height: 1.68;
  border-bottom-left-radius: inherit;
}

.site-skill-prose-inner {
  width: min(100%, 74ch);
}

.site-skill-prose :deep(*) {
  scroll-margin-top: 20px;
}

.site-skill-prose :deep(h1),
.site-skill-prose :deep(h2),
.site-skill-prose :deep(h3) {
  margin: 0;
  color: var(--site-ink);
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.site-skill-prose :deep(h1) {
  font-family: var(--site-font-display);
  font-size: clamp(1.55rem, 1.14rem + 0.96vw, 2.05rem);
  font-weight: 400;
  text-wrap: balance;
}

.site-skill-prose :deep(h2) {
  margin-top: 2.1rem;
  font-size: 1.06rem;
  font-weight: 700;
}

.site-skill-prose :deep(h3) {
  margin-top: 1.55rem;
  font-size: 0.95rem;
  font-weight: 700;
}

.site-skill-prose :deep(p),
.site-skill-prose :deep(ul),
.site-skill-prose :deep(ol),
.site-skill-prose :deep(pre),
.site-skill-prose :deep(blockquote),
.site-skill-prose :deep(hr) {
  margin: 1rem 0 0;
}

.site-skill-prose :deep(ul),
.site-skill-prose :deep(ol) {
  display: grid;
  gap: 0.42rem;
  padding-left: 1.3rem;
}

.site-skill-prose :deep(li)::marker {
  color: var(--site-text-soft);
}

.site-skill-prose :deep(a) {
  color: color-mix(in srgb, var(--site-accent) 72%, var(--site-ink));
  text-decoration-thickness: 1px;
  text-underline-offset: 0.16em;
}

.site-skill-prose :deep(a:focus-visible) {
  outline: none;
  border-radius: 0.25rem;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-accent) 16%, transparent);
}

.site-skill-prose :deep(code) {
  padding: 0.12em 0.36em;
  border: 1px solid color-mix(in srgb, var(--site-accent) 9%, var(--site-line));
  border-radius: 0.42rem;
  background: color-mix(in srgb, var(--site-accent) 6%, var(--site-surface));
  color: color-mix(in srgb, var(--site-accent) 16%, var(--site-ink));
  font-family: var(--site-font-mono);
  font-size: 0.9em;
}

.site-skill-prose :deep(pre) {
  overflow: auto;
  padding: 0.95rem 1rem;
  border: 1px solid color-mix(in srgb, var(--site-line) 92%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--site-surface) 68%, var(--site-panel));
}

.site-skill-prose :deep(pre code) {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--site-text);
}

.site-skill-prose :deep(blockquote) {
  padding: 0.85rem 1rem;
  border-left: 2px solid color-mix(in srgb, var(--site-line) 100%, transparent);
  border-radius: 0 10px 10px 0;
  background: color-mix(in srgb, var(--site-surface) 76%, transparent);
  color: var(--site-text-muted);
}

.site-skill-prose :deep(hr) {
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--site-line) 88%, transparent);
}

.site-skill-prose :deep(strong) {
  color: var(--site-ink);
}

@media (max-width: 900px) {
  .site-skill-dialog {
    inset: 0;
    margin: 0;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    border-radius: 0;
  }

  .site-skill-dialog::backdrop {
    background: rgb(15 23 42 / 12%);
    backdrop-filter: none;
  }

  .site-skill-dialog-shell {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  html.dark .site-skill-dialog-shell {
    box-shadow: none;
  }

  .site-skill-dialog-body,
  .site-skill-dialog-body.has-sidebar {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'mobilebar'
      'content';
  }

  .site-skill-dialog-mobile-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    grid-area: mobilebar;
    padding: 16px 20px 0;
  }

  .site-skill-dialog-close {
    display: none;
  }

  .site-skill-dialog-close-mobile {
    position: static;
    display: inline-flex;
    flex: none;
    width: 40px;
    height: 40px;
  }

  .site-skill-dialog-sidebar-shell {
    position: absolute;
    inset: 68px 20px 20px;
    z-index: 2;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-6px);
    transition:
      opacity 180ms ease,
      transform 180ms ease;
  }

  .site-skill-dialog-body.is-sidebar-open .site-skill-dialog-sidebar-shell {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(0);
  }

  .site-skill-dialog-sidebar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 18px;
    height: 100%;
    max-height: none;
    padding: 18px 20px 20px;
    border: 1px solid color-mix(in srgb, var(--site-line) 88%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--site-panel) 99%, transparent);
    box-shadow:
      0 12px 28px rgb(15 23 42 / 8%),
      0 1px 3px rgb(15 23 42 / 5%);
  }

  html.dark .site-skill-dialog-sidebar {
    background: color-mix(in srgb, var(--site-panel) 99%, transparent);
    box-shadow:
      0 16px 36px rgb(0 0 0 / 18%),
      0 1px 6px rgb(0 0 0 / 14%);
  }

  .site-skill-prose {
    padding-top: 18px;
  }

  .site-skill-dialog-body.is-sidebar-open .site-skill-prose {
    overflow: hidden;
  }
}

@media (min-width: 641px) and (max-width: 900px) {
  .site-skill-dialog-sidebar-section + .site-skill-dialog-sidebar-section {
    padding-top: 0;
    border-top: none;
  }
}

@media (max-width: 640px) {
  .site-skill-dialog {
    height: 100svh;
  }

  .site-skill-dialog-close {
    width: 44px;
    height: 44px;
  }

  .site-skill-dialog-close-mobile {
    width: 44px;
    height: 44px;
  }

  .site-skill-dialog-mobile-bar {
    padding: 14px 18px 0;
  }

  .site-skill-dialog-mobile-toggle {
    min-height: 44px;
  }

  .site-skill-dialog-sidebar-shell {
    inset: 66px 18px 18px;
  }

  .site-skill-dialog-sidebar {
    grid-template-columns: 1fr;
    padding: 18px;
  }

  .site-skill-prose {
    font-size: 0.92rem;
    padding-inline: 20px;
    padding-bottom: 32px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .site-skill-dialog-mobile-toggle-icon,
  .site-skill-dialog-close {
    transition: none;
  }

  .site-skill-dialog-sidebar-shell {
    transition: none;
  }
}
</style>
