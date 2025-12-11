<script setup lang="ts">
defineProps<{
  spin?: boolean
}>()
</script>

<template>
  <svg
    :class="{ 'tp-icon-refresh-spin': spin }"
    width="24"
    height="24"
    fill="none"
    viewBox="0 0 24 24"
  >
    <path
      fill="currentColor"
      fill-rule="evenodd"
      d="M7.023 11.525A5 5 0 0 1 16 9h-2a.5.5 0 0 0 0 1h3.5a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-1 0v2.183A6 6 0 0 0 6.027 11.43a.5.5 0 0 0 .996.095m10.95 1.044a.5.5 0 0 0-.996-.095A5 5 0 0 1 8 15h2a.5.5 0 1 0 0-1H6.5a.5.5 0 0 0-.5.5v3a.5.5 0 1 0 1 0v-2.183a6 6 0 0 0 10.973-2.747"
      clip-rule="evenodd"
    ></path>
  </svg>
</template>

<style scoped>
.tp-icon-refresh-spin {
  animation: tp-spin 1s linear infinite;
}

@keyframes tp-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
