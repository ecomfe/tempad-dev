<script setup lang="ts">
defineProps<{ entries: readonly { key: string; value: string }[] }>()
</script>

<template>
  <dl class="site-skill-dialog-meta">
    <div v-for="entry in entries" :key="entry.key" class="site-skill-dialog-meta-row">
      <dt>{{ entry.key }}</dt>
      <dd>{{ entry.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.site-skill-dialog-meta {
  display: grid;
  gap: 24px;
  margin: 0;
}

.site-skill-dialog-meta-row {
  display: grid;
  gap: 6px;
}

.site-skill-dialog-meta-row dt {
  color: var(--site-text-soft);
  font-family: var(--site-font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.site-skill-dialog-meta-row dd {
  margin: 0;
  color: var(--site-text);
  font-size: 0.78rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
