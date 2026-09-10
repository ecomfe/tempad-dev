<script setup lang="ts">
import { Component as ComponentIcon, PocketKnife, Variable } from 'lucide-vue-next'

import DetailList from '@/components/DetailList.vue'
import HeroFigure from '@/components/HeroFigure.vue'
import SectionShell from '@/components/SectionShell.vue'
import { SITE_LINKS } from '@/content/landing'
</script>

<template>
  <SectionShell
    id="inspect"
    title="Inspect and adapt"
    copy="Inspect directly in Figma. No agent setup required."
  >
    <div class="site-inspect-layout">
      <HeroFigure />
      <div class="site-inspect-details">
        <DetailList
          :items="[
            {
              title: 'Styles and variables',
              body: 'Read CSS and JavaScript styles, keep variable references, and adjust units and scale.',
              icon: Variable
            },
            {
              title: 'Selection and measurements',
              body: 'Select nested layers, measure spacing, and bring the selected node into view.',
              icon: PocketKnife
            },
            {
              title: 'Output plugins',
              body: 'Map components and transform styles into the syntax your codebase uses.',
              icon: ComponentIcon
            }
          ]"
        />
        <a class="site-text-link" :href="SITE_LINKS.inspectGuide" target="_blank" rel="noopener"
          >Inspection guide →</a
        >
      </div>
    </div>
  </SectionShell>
</template>
