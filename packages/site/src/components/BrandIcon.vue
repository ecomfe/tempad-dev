<script setup lang="ts">
import type { McpClientId } from '@tempad-dev/shared'

import { getMcpClientBrandSvg } from '@tempad-dev/shared/ui'
import { computed } from 'vue'

const props = defineProps<{
  clientId: McpClientId
}>()

const svgMarkup = computed(() => getMcpClientBrandSvg(props.clientId))
</script>

<template>
  <span class="site-brand-icon" aria-hidden="true" v-html="svgMarkup" />
</template>

<style scoped>
.site-brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.site-brand-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
