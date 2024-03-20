<template>
  <div class="tp-badge">
    <slot />
  </div>
</template>

<style scoped>
.tp-badge {
  display: flex;
  color: var(--color-text-brand);
  border-color: var(--color-text-brand);
  font-weight: 400;
  align-items: center;
  padding: 0 4px;
  border-width: 1px;
  border-style: solid;
  border-radius: 3px;
  line-height: 16px;
  white-space: nowrap;
  font-size: 9px;
  letter-spacing: calc(0.016px + var(--text-tracking-pos, 0) * 9px);
}
</style>
