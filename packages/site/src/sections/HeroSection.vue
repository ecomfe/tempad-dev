<script setup lang="ts">
import ActionButton from '@/components/ActionButton.vue'
import HeroWorkflow from '@/components/HeroWorkflow.vue'
import { SITE_LINKS } from '@/content/landing'
</script>

<template>
  <section id="top" class="site-hero">
    <div class="site-container">
      <div class="site-hero-layout">
        <div class="site-hero-copy">
          <h1 class="site-hero-title"><span>Design &amp; dev.</span><span>Connected.</span></h1>
          <p class="site-hero-copy-text">
            Inspect Figma designs, edit the canvas with your coding agent, and bring design context
            into your codebase.
          </p>
          <div class="site-hero-actions">
            <ActionButton href="#connect">Set up TemPad Dev</ActionButton>
            <ActionButton :href="SITE_LINKS.guide" variant="secondary" external>
              Read the guide
            </ActionButton>
          </div>
        </div>
        <HeroWorkflow />
      </div>
    </div>
  </section>
</template>
