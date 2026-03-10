<script setup lang="ts">
import type { SiteDetail, SiteDetailIconId } from '@/content/landing'
import type { Component } from 'vue'

import OpenSourceIcon from '@/components/icons/OpenSourceIcon.vue'
import {
  Braces,
  Component as ComponentIcon,
  PocketKnife,
  SquareFunction,
  Variable
} from 'lucide-vue-next'

defineProps<{
  items: readonly SiteDetail[]
}>()

const detailIcons: Record<SiteDetailIconId, Component> = {
  braces: Braces,
  component: ComponentIcon,
  'open-source': OpenSourceIcon,
  'pocket-knife': PocketKnife,
  'sliders-horizontal': SquareFunction,
  variable: Variable
}
</script>

<template>
  <div class="site-detail-list">
    <article v-for="detail in items" :key="detail.title" class="site-detail-item">
      <div class="site-detail-icon" aria-hidden="true">
        <component :is="detailIcons[detail.icon]" />
      </div>

      <div class="site-detail-copy">
        <p class="site-detail-title">{{ detail.title }}</p>
        <p class="site-detail-body">{{ detail.body }}</p>
      </div>
    </article>
  </div>
</template>
