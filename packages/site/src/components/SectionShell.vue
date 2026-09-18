<script setup lang="ts">
defineProps<{
  id: string
  title: string
  copy?: string
}>()
</script>

<template>
  <section :id="id" class="site-section">
    <div class="site-container">
      <div class="site-section-head">
        <h2 class="site-section-title">{{ title }}</h2>
        <p v-if="copy" class="site-section-copy">{{ copy }}</p>
      </div>
      <slot />
      <footer v-if="$slots.footer" class="site-section-footer">
        <slot name="footer" />
      </footer>
    </div>
  </section>
</template>
