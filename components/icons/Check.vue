<script setup lang="ts">
import { ui } from '@/ui/figma'
</script>

<template>
  <svg v-if="ui.isUi3" class="tp-icon" width="16" height="16" fill="none" viewBox="0 0 16 16">
    <path
      fill="currentColor"
      fill-rule="evenodd"
      d="M11.777 4.084a.5.5 0 0 1 .139.693l-4 6a.5.5 0 0 1-.77.077l-3-3a.5.5 0 1 1 .708-.708l2.568 2.57 3.662-5.493a.5.5 0 0 1 .693-.139"
      clip-rule="evenodd"
    ></path>
  </svg>
  <svg
    v-else
    class="tp-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="8"
    height="8"
    viewBox="0 0 8 8"
  >
    <path
      fill="curentColor"
      fill-opacity="1"
      fill-rule="evenodd"
      stroke="none"
      d="M1.176 2.824 3.06 4.706 6.824.941 8 2.118 3.059 7.059 0 4z"
    ></path>
  </svg>
</template>
