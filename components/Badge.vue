<script setup lang="ts">
defineProps<{
  title?: string
  tone?: 'brand' | 'neutral' | 'success'
  variant?: 'solid' | 'dashed'
}>()
</script>

<template>
  <div
    class="tp-badge"
    :class="[`tp-badge-${tone || 'brand'}`, `tp-badge-${variant || 'solid'}`]"
    :data-tooltip="title || null"
    :data-tooltip-type="title ? 'text' : null"
  >
    <slot />
  </div>
</template>

<style scoped>
.tp-badge {
  display: flex;
  align-items: center;
  padding: 0 4px;
  border-width: 1px;
  border-radius: 3px;
  line-height: 16px;
  white-space: nowrap;
  font-size: 9px;
  letter-spacing: calc(0.016px + var(--text-tracking-pos, 0) * 9px);
}

.tp-badge-solid {
  border-style: solid;
}

.tp-badge-dashed {
  border-style: dashed;
}

.tp-badge-brand {
  color: var(--color-text-brand);
  border-color: var(--color-text-brand);
}

.tp-badge-neutral {
  color: var(--color-text-secondary);
  border-color: var(--color-icon-disabled);
}

.tp-badge-success {
  color: var(--color-text);
  border-color: var(--color-icon-success);
}
</style>
