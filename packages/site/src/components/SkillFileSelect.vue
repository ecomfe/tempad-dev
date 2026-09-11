<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { Check, ChevronsUpDown, FileText } from 'lucide-vue-next'
import { computed, nextTick, ref, useId, watch } from 'vue'

import { vScrollbar } from '@/composables/scrollbar'

const props = defineProps<{ modelValue: string; files: { path: string }[] }>()
const emit = defineEmits<{ 'update:modelValue': [path: string] }>()
const id = useId()
const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const selectedIndex = computed(() => props.files.findIndex(({ path }) => path === props.modelValue))

onClickOutside(rootRef, () => {
  open.value = false
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
  const file = props.files[index]
  if (!file) return
  open.value = false
  emit('update:modelValue', file.path)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    return
  }
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
  else if (event.key === 'End') activeIndex.value = props.files.length - 1
  else
    activeIndex.value = Math.max(
      0,
      Math.min(props.files.length - 1, activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1))
    )
  void revealActive()
}
</script>

<template>
  <div ref="rootRef" class="site-file-select">
    <span :id="`${id}-label`" class="site-file-select-label">Files</span>
    <button
      type="button"
      class="site-file-select-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-labelledby="`${id}-label ${id}-value`"
      :aria-expanded="open"
      :aria-controls="`${id}-listbox`"
      :aria-activedescendant="open ? `${id}-option-${activeIndex}` : undefined"
      @click="open ? (open = false) : showOptions()"
      @keydown="handleKeydown"
    >
      <FileText aria-hidden="true" />
      <span :id="`${id}-value`" class="site-file-select-value">{{ modelValue }}</span>
      <ChevronsUpDown aria-hidden="true" />
    </button>
    <div v-if="open" class="site-file-select-popover">
      <ul :id="`${id}-listbox`" v-scrollbar role="listbox" :aria-labelledby="`${id}-label`">
        <li
          v-for="(file, index) in files"
          :id="`${id}-option-${index}`"
          :key="file.path"
          role="option"
          :aria-selected="file.path === modelValue"
          :class="{ 'is-active': index === activeIndex }"
          @pointermove="activeIndex = index"
          @mousedown.prevent
          @click="choose(index)"
        >
          <FileText aria-hidden="true" /><span>{{ file.path }}</span>
          <Check v-if="file.path === modelValue" aria-hidden="true" />
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.site-file-select {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  width: min(100%, 520px);
}
.site-file-select-label {
  font-size: 0.8125rem;
  color: var(--site-text-soft);
}
.site-file-select-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--site-line);
  border-radius: 6px;
  background: var(--site-panel);
  color: var(--site-text);
  text-align: left;
  cursor: pointer;
}
.site-file-select-trigger:hover {
  background: var(--site-toggle-button-hover);
}
.site-file-select-trigger:focus-visible {
  outline: 1px solid var(--site-text-soft);
  outline-offset: 2px;
}
.site-file-select svg {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--site-text-soft);
  stroke-width: 1.5;
}
.site-file-select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--site-font-mono);
  font-size: 0.75rem;
}
.site-file-select-popover {
  position: absolute;
  z-index: 5;
  top: calc(100% + 6px);
  left: 0;
  width: 100%;
  padding: 5px;
  border: 1px solid var(--site-line);
  border-radius: 8px;
  background: var(--site-panel);
  box-shadow: 0 8px 28px rgb(0 0 0 / 12%);
}
.site-file-select-popover ul {
  position: relative;
  max-height: min(320px, 50dvh);
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  overscroll-behavior: contain;
}
.site-file-select-popover li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 8px;
  border-radius: 4px;
  color: var(--site-text-muted);
  font-family: var(--site-font-mono);
  font-size: 0.75rem;
  cursor: pointer;
}
.site-file-select-popover li span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.site-file-select-popover li.is-active {
  background: var(--site-toggle-button-hover);
  color: var(--site-ink);
}
.site-file-select-popover li[aria-selected='true'] {
  color: var(--site-ink);
}
</style>
