<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  items: readonly { title: string; body: string; icon: Component }[]
}>()
</script>

<template>
  <div class="site-detail-list">
    <article v-for="detail in items" :key="detail.title" class="site-detail-item">
      <div class="site-detail-icon" aria-hidden="true">
        <component :is="detail.icon" />
      </div>

      <div class="site-detail-copy">
        <p class="site-detail-title">{{ detail.title }}</p>
        <p class="site-detail-body">{{ detail.body }}</p>
      </div>
    </article>
  </div>
</template>
