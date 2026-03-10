<script setup lang="ts">
import { computed } from 'vue'

import DetailList from '@/components/DetailList.vue'
import { useSiteColorMode } from '@/composables/useSiteColorMode'
import SectionShell from '@/components/SectionShell.vue'
import { INSPECT_DETAILS, INSPECT_SHOT } from '@/content/landing'

const { resolvedColorMode } = useSiteColorMode()
const inspectShotSrc = computed(() => INSPECT_SHOT[resolvedColorMode.value])
</script>

<template>
  <SectionShell
    id="inspect"
    eyebrow="Inspect"
    title="Reveal the design"
    copy="TemPad Dev helps surface the same selection in code, variables, and layout terms that are easier to carry into implementation."
  >
    <div class="site-section-layout">
      <figure class="site-shot">
        <img
          class="site-shot-image"
          :src="inspectShotSrc"
          :alt="INSPECT_SHOT.alt"
          :width="INSPECT_SHOT.width"
          :height="INSPECT_SHOT.height"
        />
      </figure>

      <DetailList :items="INSPECT_DETAILS" />
    </div>
  </SectionShell>
</template>
