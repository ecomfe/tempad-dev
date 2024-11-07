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
      fill="currentColor"
      fill-rule="evenodd"
      d="M15 18.5a.5.5 0 0 0 1 0v-6.55a2.5 2.5 0 0 0 0-4.9V5.5a.5.5 0 0 0-1 0v1.55a2.5 2.5 0 0 0 0 4.9v6.55Zm-1-9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Zm-6-4a.5.5 0 0 1 1 0v6.55a2.5 2.5 0 0 1 0 4.9v1.55a.5.5 0 0 1-1 0v-1.55a2.5 2.5 0 0 1 0-4.9V5.5Zm-1 9a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"
      clip-rule="evenodd"
    ></path>
  </svg>
  <svg
    v-else
    class="tp-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="32"
    height="32"
    viewBox="0 0 32 32"
  >
    <path
      fill="currentColor"
      fill-opacity="1"
      fill-rule="evenodd"
      stroke="none"
      d="M12 16.05V9h1v7.05c1.141.232 2 1.24 2 2.45 0 1.21-.859 2.218-2 2.45V23h-1v-2.05c-1.141-.232-2-1.24-2-2.45 0-1.21.859-2.218 2-2.45zm2 2.45c0 .828-.672 1.5-1.5 1.5-.828 0-1.5-.672-1.5-1.5 0-.828.672-1.5 1.5-1.5.828 0 1.5.672 1.5 1.5zm5 4.5h1v-7.05c1.141-.232 2-1.24 2-2.45 0-1.21-.859-2.218-2-2.45V9h-1v2.05c-1.141.232-2 1.24-2 2.45 0 1.21.859 2.218 2 2.45V23zm2-9.5c0-.828-.672-1.5-1.5-1.5-.828 0-1.5.672-1.5 1.5 0 .828.672 1.5 1.5 1.5.828 0 1.5-.672 1.5-1.5z"
    ></path>
  </svg>
</template>
