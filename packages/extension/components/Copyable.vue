<script setup lang="ts">
import { useCopy } from '@/composables'

defineProps<{ size?: 's' | 'm' | 'l'; variant?: 'normal' | 'block' }>()

const root = useTemplateRef('root')

const copy = useCopy(root)

function copyText() {
  if (!root.value) {
    return
  }

  void copy()
}
</script>

<template>
  <div
    class="tp-copyable"
    :class="`tp-copyable-${size || 'm'} tp-copyable-${variant || 'normal'}`"
    ref="root"
    role="button"
    tabindex="0"
    @click="copyText"
    @keydown.enter.prevent="copyText"
    @keydown.space.prevent="copyText"
  >
    <slot />
  </div>
</template>

<style scoped>
.tp-copyable {
  border-radius: 2px;
  cursor: default;
}

.tp-copyable:hover {
  background: var(--color-bg-hover);
}

.tp-copyable:focus-visible {
  outline: 1px solid var(--color-border-selected);
  outline-offset: 1px;
}

.tp-copyable-s:not(.tp-copyable-block) {
  margin-right: -2px;
  margin-left: -2px;
  padding: 0 2px;
}

.tp-copyable-m:not(.tp-copyable-block) {
  margin-right: -4px;
  margin-left: -4px;
  padding: 0 4px;
}

.tp-copyable-l:not(.tp-copyable-block) {
  margin-right: -8px;
  margin-left: -8px;
  padding: 0 8px;
}
</style>
