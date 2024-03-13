<script lang="ts" setup>
import { ref } from "vue";
import { useDraggable, watchDebounced } from "@vueuse/core";
import { options } from "@/entrypoints/ui/state";

const panel = ref<HTMLElement | null>(null);
const header = ref<HTMLElement | null>(null);

const position = options.value.panelPosition;
const { style, x, y } = useDraggable(panel, {
  initialValue: {
    x: position ? position.left : 0,
    y: position ? position.top : 0,
  },
  handle: header,
});

if (position) {
  watchDebounced(
    [x, y],
    () => {
      position.left = x.value;
      position.top = y.value;
    },
    { debounce: 300 }
  );
}
</script>

<template>
  <article ref="panel" class="tp-panel" :style="style">
    <header ref="header" class="tp-row tp-row-justify tp-panel-header">
      <slot name="header" />
    </header>
    <main class="tp-panel-main">
      <slot />
    </main>
  </article>
</template>

<style scoped>
.tp-panel {
  position: fixed;
  z-index: 7;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg);
  border-radius: 2px;
  box-shadow: var(--elevation-500-modal-window);
}

.tp-panel-header {
  flex: 0 0 auto;
  height: 41px;
  border-bottom: 1px solid var(--color-border);
  padding: 4px 8px 4px 16px;
  font-weight: 600;
  user-select: none;
  cursor: default;
  white-space: nowrap;
}

.tp-panel-main {
  flex: 1 1 auto;
  overflow-y: auto;
}

.tp-panel-header-icon {
  width: auto;
  height: 32px;
}
</style>
