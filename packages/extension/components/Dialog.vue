<script setup lang="ts">
import { nextTick, onBeforeUnmount, useId, useTemplateRef, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import Times from '@/components/icons/Times.vue'

defineProps<{
  title: string
}>()

const open = defineModel<boolean>({ default: false })
const dialog = useTemplateRef('dialog')
const titleId = `tp-dialog-title-${useId()}`

let previousFocus: HTMLElement | null = null

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function close(): void {
  open.value = false
}

function handleKeydown(event: KeyboardEvent): void {
  if (!open.value) return

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }

  if (event.key !== 'Tab') return

  const root = dialog.value
  if (!root) return

  const focusable = Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.offsetParent !== null
  )

  if (!focusable.length) {
    event.preventDefault()
    root.focus()
    return
  }

  const first = focusable[0]
  const last = focusable.at(-1)

  if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(
  open,
  async (visible) => {
    if (!visible) {
      window.removeEventListener('keydown', handleKeydown, true)
      previousFocus?.focus()
      previousFocus = null
      return
    }

    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.addEventListener('keydown', handleKeydown, true)
    await nextTick()
    dialog.value?.focus()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <Teleport to="tempad">
    <Transition name="tp-dialog">
      <div v-if="open" class="tp-dialog-overlay" @click.self="close">
        <section
          ref="dialog"
          class="tp-dialog-panel"
          :class="{ 'tp-dialog-panel-with-footer': $slots.footer }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
        >
          <header class="tp-dialog-header">
            <h2 :id="titleId" class="tp-dialog-title">{{ title }}</h2>
            <IconButton class="tp-dialog-close" title="Close" @click="close">
              <Times />
            </IconButton>
          </header>
          <div class="tp-dialog-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="tp-dialog-footer">
            <slot name="footer" :close="close" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tp-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-3);
  background: rgba(0, 0, 0, 0.5);
}

.tp-dialog-panel {
  display: grid;
  grid-template-rows: var(--spacer-6) minmax(0, 1fr);
  width: var(--tp-dialog-width, 600px);
  height: var(--tp-dialog-height, 480px);
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius-large);
  background: var(--color-bg);
  box-shadow: var(--elevation-500);
  color: var(--color-text);
  overflow: hidden;
  outline: none;
}

.tp-dialog-panel-with-footer {
  grid-template-rows: var(--spacer-6) minmax(0, 1fr) var(--spacer-6);
}

.tp-dialog-header,
.tp-dialog-footer {
  display: flex;
  align-items: center;
}

.tp-dialog-header {
  justify-content: space-between;
  padding: 0 var(--spacer-2) 0 var(--spacer-3);
  box-shadow: inset 0 -1px var(--color-border);
}

.tp-dialog-title {
  margin: 0;
  font-family: var(--text-body-medium-strong-font-family);
  font-size: var(--text-body-medium-strong-font-size);
  font-weight: var(--text-body-medium-strong-font-weight);
  letter-spacing: var(--text-body-medium-strong-letter-spacing);
  line-height: var(--text-body-medium-strong-line-height);
}

.tp-dialog-close {
  flex: 0 0 auto;
}

.tp-dialog-body {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tp-dialog-footer {
  justify-content: flex-end;
  gap: var(--spacer-1);
  padding: 0 var(--spacer-2) 0 var(--spacer-3);
  box-shadow: inset 0 1px var(--color-border);
}

.tp-dialog-enter-active,
.tp-dialog-leave-active {
  transition: opacity 0.12s ease-out;
}

.tp-dialog-enter-active .tp-dialog-panel,
.tp-dialog-leave-active .tp-dialog-panel {
  transition: transform 0.12s ease-out;
}

.tp-dialog-enter-from,
.tp-dialog-leave-to {
  opacity: 0;
}

.tp-dialog-enter-from .tp-dialog-panel,
.tp-dialog-leave-to .tp-dialog-panel {
  transform: translateY(var(--spacer-1)) scale(0.99);
}

@media (prefers-reduced-motion: reduce) {
  .tp-dialog-enter-active,
  .tp-dialog-leave-active,
  .tp-dialog-enter-active .tp-dialog-panel,
  .tp-dialog-leave-active .tp-dialog-panel {
    transition: none;
  }
}
</style>
