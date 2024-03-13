<script lang="ts" setup>
import { ref } from 'vue'
import { useCopy } from '@/entrypoints/ui/composables/copy'

const root = ref<HTMLElement>()

const copy = useCopy(root)

async function copyText() {
  if (!root.value) {
    return
  }

  copy()
}
</script>

<template>
  <div class="tp-copyable" ref="root" @click="copyText">
    <slot />
  </div>
</template>

<style scoped>
.tp-copyable {
  margin-left: -4px;
  padding: 4px;
  border-radius: 2px;
  cursor: default;
}

.tp-copyable:hover {
  background: var(--color-bg-hover);
}
</style>
