<script setup lang="ts">
import Discord from '@/components/icons/Discord.vue'
import GitHub from '@/components/icons/GitHub.vue'
import Warning from '@/components/icons/Warning.vue'
import Section from '@/components/Section.vue'
</script>

<template>
  <Section flat class="tp-error">
    <template #header>
      <div class="tp-row tp-gap tp-error-title">
        <Warning class="tp-error-icon" /> Temporarily Unavailable
      </div>
    </template>
    <p>
      TemPad Dev could not connect to Figma’s runtime. Update the extension and reload this Figma
      tab.
    </p>
    <p class="tp-error-actions">
      <a target="_blank" href="https://discord.gg/MXGXwtkEck"
        ><Discord /> Join Discord for updates</a
      >
      <a target="_blank" href="https://github.com/ecomfe/tempad-dev"
        ><GitHub /> Check out GitHub repo</a
      >
    </p>
  </Section>
</template>

<style scoped>
.tp-error {
  background-color: var(--color-bg-warning-tertiary);
  color: var(--color-text-warning);
}

.tp-error-icon {
  margin: -4px;
  color: var(--color-icon-warning);
}

p {
  margin-bottom: 8px;
  hyphens: auto;
  line-height: var(--text-body-medium-line-height);
}

a {
  display: flex;
  place-items: center;
  gap: 4px;
  height: 1.5rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

a:hover {
  color: var(--color-text-secondary-hover);
}

a .tp-icon {
  width: 12px;
  height: 12px;
  color: var(--color-icon);
}
</style>
