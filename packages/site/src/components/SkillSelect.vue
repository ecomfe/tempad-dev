<script setup lang="ts">
import { onClickOutside, useEventListener } from '@vueuse/core'
import { Check, ChevronDown } from 'lucide-vue-next'
import { computed, nextTick, ref, useId, watch, type Component } from 'vue'

import { vScrollbar } from '@/composables/scrollbar'

const props = defineProps<{
  modelValue: string
  label: string
  options: { value: string; label: string }[]
  icon?: Component
  monospace?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const selectedIndex = computed(() =>
  props.options.findIndex(({ value }) => value === props.modelValue)
)
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label)

onClickOutside(rootRef, () => {
  open.value = false
})
useEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !open.value) return
  event.preventDefault()
  event.stopPropagation()
  open.value = false
  triggerRef.value?.focus()
})
watch(
  () => props.modelValue,
  () => {
    open.value = false
  }
)

async function revealActive(): Promise<void> {
  await nextTick()
  document.getElementById(`${id}-option-${activeIndex.value}`)?.scrollIntoView({ block: 'nearest' })
}

function showOptions(): void {
  activeIndex.value = Math.max(0, selectedIndex.value)
  open.value = true
  void revealActive()
}

function choose(index: number): void {
  const option = props.options[index]
  if (!option) return
  open.value = false
  emit('update:modelValue', option.value)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab') {
    open.value = false
    return
  }
  if (['Enter', ' '].includes(event.key)) {
    event.preventDefault()
    if (open.value) choose(activeIndex.value)
    else showOptions()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  if (!open.value) {
    showOptions()
    return
  }
  if (event.key === 'Home') activeIndex.value = 0
  else if (event.key === 'End') activeIndex.value = props.options.length - 1
  else
    activeIndex.value = Math.max(
      0,
      Math.min(props.options.length - 1, activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1))
    )
  void revealActive()
}
</script>

<template>
  <div ref="rootRef" class="site-reader-select" :class="{ 'is-monospace': monospace }">
    <span :id="`${id}-label`" class="site-reader-select-label">{{ label }}</span>
    <div class="site-reader-select-control">
      <button
        ref="triggerRef"
        type="button"
        class="site-reader-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        :aria-labelledby="selectedLabel ? `${id}-label ${id}-value` : `${id}-label`"
        :aria-expanded="open"
        :aria-controls="`${id}-listbox`"
        :aria-activedescendant="open && options.length ? `${id}-option-${activeIndex}` : undefined"
        @click="open ? (open = false) : showOptions()"
        @keydown="handleKeydown"
      >
        <component :is="icon" v-if="icon" aria-hidden="true" />
        <span :id="`${id}-value`" class="site-reader-select-value">{{
          selectedLabel ?? label
        }}</span>
        <ChevronDown aria-hidden="true" class="site-reader-select-chevron" />
      </button>
      <div v-if="open" v-scrollbar class="site-reader-select-popover">
        <ul :id="`${id}-listbox`" role="listbox" :aria-labelledby="`${id}-label`">
          <li
            v-for="(option, index) in options"
            :id="`${id}-option-${index}`"
            :key="option.value"
            role="option"
            :aria-selected="option.value === modelValue"
            :class="{ 'is-active': index === activeIndex }"
            @pointermove="activeIndex = index"
            @mousedown.prevent
            @click="choose(index)"
          >
            <component :is="icon" v-if="icon" aria-hidden="true" /><span>{{ option.label }}</span>
            <Check v-if="option.value === modelValue" aria-hidden="true" />
          </li>
        </ul>
        <div v-if="$slots.details" class="site-reader-select-details"><slot name="details" /></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.site-reader-select {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  width: min(100%, 520px);
}
.site-reader-select-label {
  font-size: 0.8125rem;
  color: var(--site-text-soft);
}
.site-reader-select-control {
  position: relative;
  flex: 1;
  min-width: 0;
}
.site-reader-select-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--site-line);
  border-radius: 6px;
  background: var(--site-panel);
  color: var(--site-text);
  text-align: left;
  cursor: pointer;
}
.site-reader-select-trigger:hover {
  background: var(--site-toggle-button-hover);
}
.site-reader-select-trigger:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--site-accent) 36%, var(--site-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-accent) 14%, transparent);
}
.site-reader-select svg {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--site-text-soft);
  stroke-width: 1.5;
}
.site-reader-select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
}
.site-reader-select-popover {
  position: absolute;
  z-index: 5;
  top: calc(100% + 6px);
  left: 0;
  width: 100%;
  max-height: min(320px, 50dvh);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 5px;
  border: 1px solid var(--site-line);
  border-radius: 8px;
  background: var(--site-panel);
  box-shadow: 0 8px 28px rgb(0 0 0 / 12%);
}
.site-reader-select-popover ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.site-reader-select-popover li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 8px;
  border-radius: 4px;
  color: var(--site-text-muted);
  font-size: 0.75rem;
  cursor: pointer;
}
.site-reader-select-popover li span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.site-reader-select-popover li.is-active {
  background: var(--site-toggle-button-hover);
  color: var(--site-ink);
}
.site-reader-select-popover li[aria-selected='true'] {
  color: var(--site-ink);
}

.is-monospace .site-reader-select-value,
.is-monospace .site-reader-select-popover li {
  font-family: var(--site-font-mono);
}
.site-reader-select-details {
  padding: 12px 8px 8px;
}
.site-reader-select-chevron {
  transition: transform 180ms ease;
}
.site-reader-select-trigger[aria-expanded='true'] .site-reader-select-chevron {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .site-reader-select-chevron {
    transition: none;
  }
}

@media (max-width: 900px) {
  .site-reader-select {
    width: 100%;
  }

  .site-reader-select-label {
    display: none;
  }

  .site-reader-select-trigger {
    height: 44px;
  }

  .site-reader-select-value {
    font-size: 0.8125rem;
  }
}
</style>
