<script setup lang="ts">
defineProps<{
  id: string
  eyebrow: string
  title: string
  copy?: string
}>()
</script>

<template>
  <section :id="id" class="site-section">
    <div class="site-container">
      <div class="site-section-head">
        <p class="site-eyebrow">{{ eyebrow }}</p>
        <h2 class="site-section-title">{{ title }}</h2>
        <p v-if="copy" class="site-section-copy">{{ copy }}</p>
      </div>
      <slot />
    </div>
  </section>
</template>
