<script lang="ts" setup>
import { useSlots, Transition } from "vue";

const props = defineProps<{
  title?: string;
  collapsed?: boolean;
  flat?: boolean;
}>();

const { header } = useSlots();

function beforeEnter(el: Element) {
  (el as HTMLElement).style.height = "0";
}

function enter(el: Element) {
  const styles = getComputedStyle(el as HTMLElement);
  const paddingTop = parseInt(
    styles.getPropertyValue("--tp-section-padding-top"),
    10
  );
  const paddingBottom = parseInt(
    styles.getPropertyValue("--tp-section-padding-bottom"),
    10
  );

  (el as HTMLElement).style.height = `${
    (el as HTMLElement).scrollHeight + paddingTop + paddingBottom
  }px`;
}

function afterEnter(el: Element) {
  (el as HTMLElement).style.height = "";
}

function beforeLeave(el: Element) {
  (el as HTMLElement).style.height = `${(el as HTMLElement).scrollHeight}px`;
}

function leave(el: Element) {
  if ((el as HTMLElement).scrollHeight) {
    (el as HTMLElement).style.height = "0";
  }
}

function afterLeave(el: Element) {
  (el as HTMLElement).style.height = "";
}
</script>

<template>
  <Transition
    name="tp-section"
    @before-enter="beforeEnter"
    @enter="enter"
    @after-enter="afterEnter"
    @before-leave="beforeLeave"
    @leave="leave"
    @after-leave="afterLeave"
  >
    <section
      class="tp-section"
      :class="{ 'tp-section-flat': props.flat }"
      v-if="!collapsed"
    >
      <header v-if="title || header" class="tp-row tp-section-header">
        <slot name="header">{{ props.title }}</slot>
      </header>
      <div class="tp-section-content">
        <slot />
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.tp-section {
  --tp-section-padding-top: 8px;
  --tp-section-padding-bottom: 8px;
  padding-top: var(--tp-section-padding-top);
  padding-bottom: var(--tp-section-padding-bottom);
  overflow: hidden;
}

.tp-section:not(:first-child) {
  border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.1));
}

.tp-section-flat {
  --tp-section-padding-top: 0 !important;
  --tp-section-padding-bottom: 0 !important;
}

.tp-section-header {
  height: 32px;
  padding-right: 8px;
  padding-left: 16px;
  font-weight: 600;
  user-select: none;
  cursor: default;
}

.tp-section-content {
  padding: 0 16px;
}

.tp-section-enter-active,
.tp-section-leave-active {
  transition-property: height, padding;
  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.87, 0, 0.13, 1);
}

.tp-section-enter-from,
.tp-section-leave-to {
  padding-top: 0;
  padding-bottom: 0;
}

.tp-section-enter-to,
.tp-section-leave-from {
  padding-top: var(--tp-section-padding-top);
  padding-bottom: var(--tp-section-padding-bottom);
}
</style>
