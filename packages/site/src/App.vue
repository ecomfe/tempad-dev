<script setup lang="ts">
import type { Component } from 'vue'

import { Moon, Sun, SunMoon, Twitter } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import BrandMark from '@/components/BrandMark.vue'
import DiscordIcon from '@/components/icons/DiscordIcon.vue'
import GitHubIcon from '@/components/icons/GitHubIcon.vue'
import { useSiteColorMode, type SiteColorMode } from '@/composables/useSiteColorMode'
import { SITE_LINKS } from '@/content/landing'
import ConnectSection from '@/sections/ConnectSection.vue'
import HeroSection from '@/sections/HeroSection.vue'
import InspectSection from '@/sections/InspectSection.vue'
import TransformSection from '@/sections/TransformSection.vue'

type SiteColorModeOption = {
  value: SiteColorMode
  label: string
  icon: Component
}

type ColorModeCyclePhase = 'after-auto' | 'before-auto' | null

const COLOR_MODE_OPTIONS: readonly SiteColorModeOption[] = [
  { value: 'light', label: 'Light mode', icon: Sun },
  { value: 'auto', label: 'Auto mode', icon: SunMoon },
  { value: 'dark', label: 'Dark mode', icon: Moon }
] as const

const isScrolled = ref(false)
const colorModeCyclePhase = ref<ColorModeCyclePhase>(null)
const { colorMode, resolvedColorMode, selectedColorMode } = useSiteColorMode()
const activeColorModeOption = computed(
  () => COLOR_MODE_OPTIONS.find((option) => option.value === selectedColorMode.value)!
)

function syncHeaderState(): void {
  isScrolled.value = window.scrollY > 16
}

function setColorMode(mode: SiteColorMode): void {
  colorMode.store.value = mode
}

function cycleColorMode(): void {
  switch (selectedColorMode.value) {
    case 'auto':
      colorModeCyclePhase.value = 'after-auto'
      setColorMode(resolvedColorMode.value === 'light' ? 'dark' : 'light')
      return
    case 'light':
    case 'dark':
      if (colorModeCyclePhase.value === 'after-auto') {
        colorModeCyclePhase.value = 'before-auto'
        setColorMode(selectedColorMode.value === 'light' ? 'dark' : 'light')
        return
      }

      if (colorModeCyclePhase.value === 'before-auto') {
        colorModeCyclePhase.value = null
        setColorMode('auto')
        return
      }

      colorModeCyclePhase.value = 'before-auto'
      setColorMode(selectedColorMode.value === 'light' ? 'dark' : 'light')
      return
  }
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
        <div class="site-brand">
          <BrandMark />
          <span class="site-brand-name">
            <span class="is-tempad">TemPad</span>
            <span class="is-dev">Dev</span>
          </span>
        </div>

        <div class="site-header-actions">
          <button
            type="button"
            class="site-header-icon-control site-mode-button is-cycling"
            :aria-label="activeColorModeOption.label"
            :title="activeColorModeOption.label"
            @click="cycleColorMode"
          >
            <component :is="activeColorModeOption.icon" aria-hidden="true" />
          </button>
          <a
            :href="SITE_LINKS.github"
            target="_blank"
            rel="noopener"
            class="site-header-icon-control site-icon-link"
            aria-label="GitHub"
          >
            <GitHubIcon aria-hidden="true" />
          </a>
          <a
            :href="SITE_LINKS.discord"
            target="_blank"
            rel="noopener"
            class="site-header-icon-control site-icon-link"
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
