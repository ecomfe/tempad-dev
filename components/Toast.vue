<script lang="ts" setup>
import { useToast } from '@/entrypoints/ui/composables/toast'

const { message, shown } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="tp-toast" :aria-hidden="`${!shown}`">
      <div
        class="tp-toast-message"
        :class="{
          'tp-toast-message-shown': shown
        }"
      >
        <div class="tp-toast-tex">{{ message }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tp-toast {
  position: fixed;
  display: flex;
  width: 100%;
  bottom: 24px;
  pointer-events: none;
  justify-content: center;
  align-items: center;
  z-index: 11;
  transition: bottom 0.2s;
}

.tp-toast-message {
  background: var(--color-bg-menu);
  transition: transform 0.3s ease-out;
  visibility: hidden;
  transition-property: transform, opacity;
  transform: translate3d(0, 3px, 0);
  opacity: 0;
  user-select: none;
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  align-items: center;
  max-width: 800px;
  margin: 0 50px;
  pointer-events: none;
  box-shadow: var(
    --elevation-400-menu-panel,
    0px 5px 17px rgba(0, 0, 0, 0.2),
    0px 2px 7px rgba(0, 0, 0, 0.15),
    inset 0 0 0 0.5px var(--bg-overlay-inner-outline),
    0 0 0 0.5px var(--bg-overlay-outline)
  );

  font-size: 14px;
  line-height: 24px;
  letter-spacing: calc(-0.006px + var(--text-tracking-pos, 0) * 14px);
  font-family: var(--inter-font-family, 'Inter'), sans-serif;
  -webkit-font-smoothing: antialiased;
  color: #fff;
}

.tp-toast-message-shown {
  transform: translateZ(0);
  opacity: 1;
  transition-duration: 0.1s;
  visibility: visible;
  transition-delay: 0ms;
  pointer-events: auto;
  cursor: default;
}

.tp-toast-tex {
  padding: 6px 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
