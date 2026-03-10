<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    href?: string
    variant?: 'primary' | 'secondary' | 'ghost'
    external?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    variant: 'primary',
    type: 'button'
  }
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <a
    v-if="props.href"
    :href="props.href"
    class="site-button"
    :class="`is-${props.variant}`"
    :target="props.external ? '_blank' : undefined"
    :rel="props.external ? 'noopener noreferrer' : undefined"
  >
    <slot />
  </a>
  <button
    v-else
    :type="props.type"
    class="site-button"
    :class="`is-${props.variant}`"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>
