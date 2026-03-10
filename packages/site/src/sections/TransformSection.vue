<script setup lang="ts">
import DetailList from '@/components/DetailList.vue'
import SectionShell from '@/components/SectionShell.vue'
import { TRANSFORM_DETAILS } from '@/content/landing'
</script>

<template>
  <SectionShell
    id="transform"
    eyebrow="Transform"
    title="Shape it your way"
    copy="Keep the source intact, then let plugins shape the output around the conventions your team already ships."
  >
    <div class="site-section-layout">
      <figure class="site-shot">
        <img
          class="site-shot-image"
          src="/marketing/plugins-light.png"
          alt="TemPad Dev plugin output for a selected button inside Figma."
        />
      </figure>

      <DetailList :items="TRANSFORM_DETAILS" />
    </div>
  </SectionShell>
</template>
