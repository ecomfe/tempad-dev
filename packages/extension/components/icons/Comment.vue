<script setup lang="ts">
import { useId } from 'vue'

const clipId = useId()
const outline = 'M4 2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7l-3 2v-2a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z'
</script>

<template>
  <svg viewBox="0 0 16 16" fill="none">
    <path
      :d="outline"
      fill="var(--comment-inner-stroke, none)"
      stroke="currentColor"
      stroke-linejoin="round"
    />
    <path
      :d="outline"
      stroke="var(--comment-inner-stroke, none)"
      stroke-linejoin="round"
      :clip-path="`url(#${clipId})`"
    />
    <path d="M5 5.5h6M5 8.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    <defs>
      <clipPath :id="clipId">
        <path :d="outline" />
      </clipPath>
    </defs>
  </svg>
</template>
