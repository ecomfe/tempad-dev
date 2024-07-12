<script lang="ts" setup>
import IconButton from './IconButton.vue'
import Times from './icons/Times.vue'
import { useToast } from '@/entrypoints/ui/composables/toast'
import { ui } from '@/entrypoints/ui/figma'

const { message, shown, hide } = useToast()
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
        <div class="tp-toast-text">{{ message }}</div>
        <div v-if="ui.isUi3" class="tp-toast-button">
          <IconButton @click="hide">
            <Times />
          </IconButton>
        </div>
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

body:not([data-fpl-version='ui3']) .tp-toast-message {
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

body:not([data-fpl-version='ui3']) .tp-toast-message-shown {
  transform: translateZ(0);
  opacity: 1;
  transition-duration: 0.1s;
  visibility: visible;
  transition-delay: 0ms;
  pointer-events: auto;
  cursor: default;
}

body:not([data-fpl-version='ui3']) .tp-toast-text {
  padding: 6px 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[data-fpl-version='ui3'] .tp-toast {
  bottom: 76px;
}

[data-fpl-version='ui3'] .tp-toast-message {
  display: inline-flex;
  align-items: center;
  background: var(--color-bg);
  border-radius: var(--radius-large);
  box-shadow: var(--elevation-100);
  height: var(--spacer-6);
  padding: 0 var(--spacer-2);
  visibility: hidden;
}

[data-fpl-version='ui3'] .tp-toast-message-shown {
  visibility: visible;
  pointer-events: auto;
}

[data-fpl-version='ui3'] .tp-toast-text {
  padding-left: var(--spacer-2);
  font-family: var(--text-body-medium-strong-font-family);
  font-size: var(--text-body-medium-strong-font-size);
  font-weight: var(--text-body-medium-strong-font-weight);
  letter-spacing: var(--text-body-medium-strong-letter-spacing);
  line-height: var(--text-body-medium-strong-line-height);
  color: var(--color-text);
  padding: 0 var(--spacer-1);
}

[data-fpl-version='ui3'] .tp-toast-button {
  align-items: center;
  display: inline-flex;
  height: 100%;
  margin-left: calc(var(--spacer-3) - var(--spacer-1));
  border-left: 1px solid var(--color-bordertranslucent);
  padding-left: var(--spacer-2);
  padding-right: var(--spacer-0);
}
</style>
