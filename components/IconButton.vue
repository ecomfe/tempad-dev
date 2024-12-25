<script setup lang="ts">
const props = defineProps<{
  type?: 'button' | 'submit' | 'reset'
  toggle?: boolean | 'normal' | 'subtle'
  variant?: 'normal' | 'secondary'
  title?: string
  dull?: boolean
}>()

const selected = defineModel<boolean>('selected')

const classes = computed(() => {
  const variant = props.variant || 'normal'
  const toggleVariant = typeof props.toggle === 'string' ? props.toggle : 'normal'

  return {
    [`tp-button-${variant}`]: true,
    [`tp-button-dull`]: props.dull,
    [`tp-button-selected-${toggleVariant}`]: selected.value
  }
})

function handleClick() {
  if (props.toggle) {
    selected.value = !selected.value
  }
}
</script>

<template>
  <button
    class="tp-button"
    :class="classes"
    :type="type || 'button'"
    :data-tooltip="title || null"
    :data-tooltip-type="title ? 'text' : null"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<style scoped>
.tp-button {
  display: flex;
  align-items: center;
  justify-content: center;
  --icon-button-height: 32px;
  height: var(--icon-button-height);
  width: var(--icon-button-height);
  flex: none;
  line-height: var(--icon-button-height);
  border: 1px solid transparent;
  position: relative;
  border-radius: var(--icon-button-radius);
  background-clip: padding-box;
  --icon-button-color-bg: trasparent;
  background-color: var(--icon-button-color-bg);
  color: var(--color-icon);
  grid-column-end: span 4;
  --icon-button-radius: 0.125rem;
  --icon-button-outline-offset: -0.125rem;
  --icon-button-outline-width: 0.125rem;
}

[data-fpl-version='ui3'] .tp-button {
  --icon-button-outline-offset: -0.0625rem;
  --icon-button-outline-width: 0.0625rem;
}

.tp-button:hover {
  border-radius: 3px;
}

.tp-button:focus-visible {
  --icon-button-outline-color: var(--color-border-selected);
  outline: var(--icon-button-outline-color) solid var(--icon-button-outline-width);
  outline-offset: var(--icon-button-outline-offset);
  border-radius: var(--icon-button-radius);
}

.tp-button-selected-normal {
  --icon-button-color-bg: var(--color-bg-brand) !important;
  --color-icon: var(--color-icon-onbrand) !important;
  border-radius: 3px;
}

.tp-button-selected-subtle {
  --icon-button-color-bg: var(--color-bg-tertiary) !important;
  border-radius: 3px;
}

.tp-button-normal:not(:disabled):not(.tp-button-dull):hover {
  --icon-button-color-bg: var(--color-bg-hover);
}

.tp-button-secondary {
  --color-icon: var(--color-icon-secondary);
}

.tp-button-secondary:not(:disabled):not(.tp-button-dull):hover {
  --icon-button-color-bg: var(--color-bg-tertiary);
  --color-icon: var(--color-text);
}

.tp-button:disabled {
  --color-icon: var(--color-icon-disabled);
}

[data-fpl-version='ui3'] .tp-button {
  --icon-button-size: 1.5rem;
  --icon-button-icon-size: 1.5rem;
  --icon-button-radius: var(--radius-medium);

  width: var(--icon-button-size);
  height: var(--icon-button-size);
  border: none;
  border-radius: var(--icon-button-radius);
}

:slotted([data-fpl-version='ui3'] .tp-button svg) {
  width: var(--icon-button-size);
  height: var(--icon-button-size);
}

[data-fpl-version='ui3'] .tp-button-selected-normal {
  --icon-button-color-bg: var(--color-bg-selected) !important;
  --color-icon: var(--color-icon-brand) !important;
}

[data-fpl-version='ui3'] .tp-button-selected-normal:hover {
  background: var(--color-bg-selected-secondary);
}
</style>
