<script setup lang="ts">
import { ui } from '@/entrypoints/ui/figma'
</script>

<template>
  <svg
    v-if="ui.isUi3"
    class="tp-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    fill="none"
    viewBox="0 0 24 24"
  >
    <path
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 6.5v11M6.5 12h11"
    ></path>
  </svg>
  <svg
    v-else
    class="tp-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 12 12"
  >
    <path
      fill="currentColor"
      fill-opacity="1"
      fill-rule="nonzero"
      stroke="none"
      d="M5.5 5.5v-5h1v5h5v1h-5v5h-1v-5h-5v-1h5z"
    ></path>
  </svg>
</template>
