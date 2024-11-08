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
    viewBox="-6 -6 24 24"
  >
    <path
      fill="currentColor"
      fill-opacity="1"
      fill-rule="nonzero"
      stroke="none"
      d="M6 12c3.314 0 6-2.686 6-6 0-3.314-2.686-6-6-6-3.314 0-6 2.686-6 6 0 3.314 2.686 6 6 6zm0-.667C3.054 11.333.667 8.946.667 6 .667 3.054 3.054.667 6 .667c2.946 0 5.333 2.387 5.333 5.333 0 2.946-2.387 5.333-5.333 5.333zm-.666-6h1.333v4H5.334v-4zm0-2c0-.368.298-.666.667-.666.368 0 .666.298.666.666 0 .369-.298.667-.666.667-.369 0-.667-.298-.667-.667z"
    ></path>
  </svg>
  <svg
    v-else
    class="tp-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      fill="currentColor"
      fill-opacity=".9"
      fill-rule="nonzero"
      stroke="none"
      d="M8 14c3.314 0 6-2.686 6-6 0-3.314-2.686-6-6-6-3.314 0-6 2.686-6 6 0 3.314 2.686 6 6 6zm0-1c-2.946 0-5-2.054-5-5 0-2.946 2.054-5 5-5 2.946 0 5 2.054 5 5 0 2.946-2.054 5-5 5zm-.5-5.667h1v4h-1v-4zm-.166-2c0-.368.298-.666.667-.666.368 0 .666.298.666.666 0 .369-.298.667-.666.667-.369 0-.667-.298-.667-.667z"
    ></path>
  </svg>
</template>
