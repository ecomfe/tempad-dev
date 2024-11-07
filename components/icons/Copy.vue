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
      d="M10 6h4v1h-4V6ZM9 6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1 2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm0 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1 1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1Zm1 3.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm.5 2.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3Z"
      clip-rule="evenodd"
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
      fill-rule="evenodd"
      d="M10 2H6c-.276 0-.5.224-.5.5v1c0 .276.224.5.5.5h4c.276 0 .5-.224.5-.5v-1c0-.276-.224-.5-.5-.5ZM6 1c-.828 0-1.5.672-1.5 1.5H4c-1.105 0-2 .895-2 2V13c0 1.105.895 2 2 2h8c1.105 0 2-.895 2-2V4.5c0-1.105-.895-2-2-2h-.5c0-.828-.672-1.5-1.5-1.5H6Zm6 2.5h-.5c0 .828-.672 1.5-1.5 1.5H6c-.828 0-1.5-.672-1.5-1.5H4c-.552 0-1 .448-1 1V13c0 .552.448 1 1 1h8c.552 0 1-.448 1-1V4.5c0-.552-.448-1-1-1ZM5.5 8h5V7h-5v1Zm5 3h-5v-1h5v1Z"
      clip-rule="evenodd"
    ></path>
  </svg>
</template>
