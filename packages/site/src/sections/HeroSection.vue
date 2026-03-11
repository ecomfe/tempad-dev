<script setup lang="ts">
import ActionButton from '@/components/ActionButton.vue'
import HeroFigure from '@/components/HeroFigure.vue'
import { SITE_LINKS } from '@/content/landing'
</script>

<template>
  <section id="top" class="site-hero">
    <div class="site-container">
      <div class="site-hero-layout">
        <div class="site-hero-copy">
          <h1 class="site-hero-title">Inspect, transform, connect.</h1>
          <p class="site-hero-copy-text">
            <span class="site-hero-copy-lead">Open handoff tooling for Figma.</span>
            Free and open source, made to keep design context legible, adaptable, and available to
            everyone who builds from it.
          </p>
          <div class="site-hero-actions">
            <ActionButton :href="SITE_LINKS.install" external>Install extension</ActionButton>
            <ActionButton :href="SITE_LINKS.github" variant="secondary" external>
              View on GitHub
            </ActionButton>
          </div>
        </div>

        <HeroFigure />
      </div>
    </div>
  </section>
</template>
