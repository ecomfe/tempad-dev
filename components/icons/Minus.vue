<script setup lang="ts">
import { ui } from '@/ui/figma'
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
    <path stroke="currentColor" stroke-linecap="round" d="M6.5 12h11"></path>
  </svg>
  <svg
    v-else
    class="tp-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="6"
    viewBox="0 0 12 6"
  >
    <path
      fill="currentColor"
      fill-opacity="1"
      fill-rule="nonzero"
      stroke="none"
      d="M11.5 3.5H.5v-1h11v1z"
    ></path>
  </svg>
</template>
