<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: 'primary' | 'secondary'
  }>(),
  {
    type: 'button',
    variant: 'secondary'
  }
)
</script>

<template>
  <button :type="type" class="tp-action-button" :class="`tp-action-button-${variant}`">
    <slot />
  </button>
</template>

<style scoped>
.tp-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-1);
  height: var(--spacer-4);
  padding: 0 var(--spacer-2);
  border-radius: var(--radius-medium);
  color: var(--color-text);
  font-family: var(--text-body-medium-font-family);
  font-size: var(--text-body-medium-font-size);
  font-weight: var(--text-body-medium-font-weight);
  letter-spacing: var(--text-body-medium-letter-spacing);
  line-height: var(--text-body-medium-line-height);
  outline: 1px solid transparent;
  outline-offset: -1px;
}

.tp-action-button-secondary {
  background: transparent;
  outline-color: var(--color-border);
}

.tp-action-button-secondary:hover {
  background: var(--color-bg-hover);
}

.tp-action-button-secondary:active {
  background: var(--color-bg-pressed);
}

.tp-action-button-primary {
  background: var(--color-bg-brand);
  color: var(--color-text-onbrand);
}

.tp-action-button-primary:hover {
  background: var(--color-bg-brand-hover);
}

.tp-action-button-primary:active {
  background: var(--color-bg-brand-pressed);
}

.tp-action-button-secondary:focus-visible {
  outline-color: var(--color-border-selected);
}

.tp-action-button-primary:focus-visible {
  outline-color: var(--color-border-onbrand-strong);
}

.tp-action-button-secondary:disabled {
  background: transparent;
  color: var(--color-text-disabled);
  outline-color: var(--color-border-disabled);
}

.tp-action-button-primary:disabled {
  background: var(--color-bg-disabled);
  color: var(--color-text-ondisabled);
}

:slotted(svg) {
  flex: 0 0 auto;
}
</style>
