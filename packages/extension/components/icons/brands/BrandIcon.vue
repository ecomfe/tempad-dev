<script setup lang="ts">
import type { McpClientId } from '@tempad-dev/shared'

import { getMcpClientBrandSvg } from '@tempad-dev/shared/ui'
import { computed } from 'vue'

const props = defineProps<{
  id: McpClientId
}>()

const svgMarkup = computed(() => getMcpClientBrandSvg(props.id))
</script>

<template>
  <span class="tp-brand-icon" aria-hidden="true" v-html="svgMarkup" />
</template>

<style scoped>
.tp-brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.tp-brand-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
