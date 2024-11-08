<script setup lang="ts">
import { ui } from '@/ui/figma'
</script>

<template>
  <svg
    v-if="ui.isUi3"
    class="tp-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="32"
    height="32"
    fill="none"
    viewBox="-4 -4 32 32"
  >
    <path
      fill="var(--color-icon)"
      fill-rule="evenodd"
      d="M16 5H8v2h8V5Zm1 0v2h2V5.5a.5.5 0 0 0-.5-.5H17ZM5.5 5H7v2H5V5.5a.5.5 0 0 1 .5-.5ZM19 8H5v10.5a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V8ZM5.5 4A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 18.5 4h-13Zm8.061 10.087.165-.103.435-.272a.25.25 0 0 0 0-.424l-.435-.272-.165-.103-.004-.003-2.057-1.285-.017-.01-.261-.164-.34-.212a.25.25 0 0 0-.382.212v4.098a.25.25 0 0 0 .383.212l.339-.212.26-.163.018-.011 2.057-1.285.004-.003Zm1.13-1.647-3.279-2.049a1.25 1.25 0 0 0-1.912 1.06v4.098a1.25 1.25 0 0 0 1.912 1.06l3.279-2.049a1.25 1.25 0 0 0 0-2.12Z"
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
      fill-opacity="1"
      fill-rule="evenodd"
      stroke="none"
      d="M3 3h10v4h1V3c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v10c0 .552.448 1 1 1h3v-1H3V3zm5 12 7-4-7-4v8zm1-6.277v4.554L12.984 11 9 8.723z"
    ></path>
  </svg>
</template>
