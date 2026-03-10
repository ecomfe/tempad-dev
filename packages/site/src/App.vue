<script setup lang="ts">
import { Twitter } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import BrandMark from '@/components/BrandMark.vue'
import DiscordIcon from '@/components/icons/DiscordIcon.vue'
import GitHubIcon from '@/components/icons/GitHubIcon.vue'
import { SITE_LINKS } from '@/content/landing'
import ConnectSection from '@/sections/ConnectSection.vue'
import HeroSection from '@/sections/HeroSection.vue'
import InspectSection from '@/sections/InspectSection.vue'
import TransformSection from '@/sections/TransformSection.vue'

const isScrolled = ref(false)

function syncHeaderState() {
  isScrolled.value = window.scrollY > 16
}

onMounted(() => {
  syncHeaderState()
  window.addEventListener('scroll', syncHeaderState, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', syncHeaderState)
})
</script>

<template>
  <div class="site-page">
    <header class="site-header" :class="{ 'is-scrolled': isScrolled }">
      <div class="site-container site-header-inner">
        <a href="#top" class="site-brand" aria-label="TemPad Dev homepage">
          <BrandMark />
          <span class="site-brand-name">
            <span class="is-tempad">TemPad</span>
            <span class="is-dev">Dev</span>
          </span>
        </a>

        <div class="site-header-actions">
          <a
            :href="SITE_LINKS.github"
            target="_blank"
            rel="noopener"
            class="site-icon-link"
            aria-label="GitHub"
          >
            <GitHubIcon aria-hidden="true" />
          </a>
          <a
            :href="SITE_LINKS.discord"
            target="_blank"
            rel="noopener"
            class="site-icon-link"
            aria-label="Discord"
          >
            <DiscordIcon aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>

    <main>
      <HeroSection />
      <InspectSection />
      <TransformSection />
      <ConnectSection />
    </main>

    <footer class="site-footer">
      <div class="site-container site-footer-inner">
        <a
          href="https://x.com/_justineo"
          target="_blank"
          rel="noopener"
          class="site-footer-link site-footer-link-icon"
          aria-label="Twitter"
        >
          <Twitter aria-hidden="true" />
        </a>
        <span class="site-footer-separator" aria-hidden="true">·</span>
        <a :href="SITE_LINKS.license" target="_blank" rel="noopener" class="site-footer-link">
          MIT
        </a>
      </div>
    </footer>
  </div>
</template>
