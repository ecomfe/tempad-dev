<script setup lang="ts">
import DetailList from '@/components/DetailList.vue'
import SectionShell from '@/components/SectionShell.vue'
import { INSPECT_DETAILS } from '@/content/landing'
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
          src="/marketing/code-light.png"
          alt="TemPad Dev showing generated code for a selected frame in Figma."
        />
      </figure>

      <DetailList :items="INSPECT_DETAILS" />
    </div>
  </SectionShell>
</template>
