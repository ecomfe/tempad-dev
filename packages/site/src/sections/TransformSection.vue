<script setup lang="ts">
import { computed } from 'vue'

import DetailList from '@/components/DetailList.vue'
import { useSiteColorMode } from '@/composables/useSiteColorMode'
import SectionShell from '@/components/SectionShell.vue'
import { TRANSFORM_DETAILS, TRANSFORM_SHOT } from '@/content/landing'

const { resolvedColorMode } = useSiteColorMode()
const transformShotSrc = computed(() => TRANSFORM_SHOT[resolvedColorMode.value])
</script>

<template>
  <SectionShell
    id="transform"
    eyebrow="Transform"
    title="Shape it your way"
    copy="Keep the source intact, then let plugins shape the output to match the conventions your codebase already uses."
  >
    <div class="site-section-layout">
      <figure class="site-shot">
        <img
          class="site-shot-image"
          :src="transformShotSrc"
          :alt="TRANSFORM_SHOT.alt"
          :width="TRANSFORM_SHOT.width"
          :height="TRANSFORM_SHOT.height"
        />
      </figure>

      <DetailList :items="TRANSFORM_DETAILS" />
    </div>
  </SectionShell>
</template>
