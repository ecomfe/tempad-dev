<script setup lang="ts">
import { HERO_CAROUSEL_SLIDES } from '@/content/landing'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

type HeroGlowSpec = {
  id: number
  rgb: string
  centerX: number
  centerY: number
  width: number
  height: number
  driftX: number
  driftY: number
  scaleBase: number
  scaleAmp: number
  opacityBase: number
  opacityAmp: number
  speed: number
  phase: number
  blur: number
}

const GALLERY_TRANSITION_MS = 1320

const HERO_GLOW_SPECS: readonly HeroGlowSpec[] = [
  {
    id: 0,
    rgb: '242 78 30',
    centerX: 44,
    centerY: 43,
    width: 104,
    height: 92,
    driftX: 24,
    driftY: 18,
    scaleBase: 1.06,
    scaleAmp: 0.2,
    opacityBase: 0.46,
    opacityAmp: 0.16,
    speed: 0.16,
    phase: 0.4,
    blur: 138
  },
  {
    id: 1,
    rgb: '255 114 98',
    centerX: 58,
    centerY: 44,
    width: 88,
    height: 80,
    driftX: 18,
    driftY: 24,
    scaleBase: 0.98,
    scaleAmp: 0.18,
    opacityBase: 0.4,
    opacityAmp: 0.15,
    speed: 0.13,
    phase: 1.7,
    blur: 122
  },
  {
    id: 2,
    rgb: '162 89 255',
    centerX: 52,
    centerY: 52,
    width: 84,
    height: 76,
    driftX: 20,
    driftY: 16,
    scaleBase: 0.94,
    scaleAmp: 0.16,
    opacityBase: 0.34,
    opacityAmp: 0.14,
    speed: 0.18,
    phase: 2.8,
    blur: 116
  },
  {
    id: 3,
    rgb: '26 188 254',
    centerX: 42,
    centerY: 58,
    width: 114,
    height: 98,
    driftX: 26,
    driftY: 20,
    scaleBase: 1.04,
    scaleAmp: 0.2,
    opacityBase: 0.42,
    opacityAmp: 0.16,
    speed: 0.12,
    phase: 3.3,
    blur: 148
  },
  {
    id: 4,
    rgb: '10 207 131',
    centerX: 60,
    centerY: 56,
    width: 98,
    height: 86,
    driftX: 22,
    driftY: 18,
    scaleBase: 1.02,
    scaleAmp: 0.18,
    opacityBase: 0.38,
    opacityAmp: 0.14,
    speed: 0.15,
    phase: 4.6,
    blur: 128
  }
] as const

const activeIndex = ref(0)
const outgoingIndex = ref<number | null>(null)
const slideIsAnimating = ref(false)
const prefersReducedMotion = ref(false)
const incomingLayerRef = ref<HTMLDivElement | null>(null)
const glowRefs = ref<(HTMLSpanElement | null)[]>([])

let autoplayTimer: number | undefined
let cleanupTimer: number | undefined
let glowFrame: number | undefined
let motionMediaQuery: MediaQueryList | undefined

const activeSlide = computed(() => HERO_CAROUSEL_SLIDES[activeIndex.value]!)
const outgoingSlide = computed(() =>
  outgoingIndex.value === null ? null : HERO_CAROUSEL_SLIDES[outgoingIndex.value]!
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clearAutoplay(): void {
  if (autoplayTimer) {
    window.clearTimeout(autoplayTimer)
    autoplayTimer = undefined
  }
}

function clearCleanupTimer(): void {
  if (cleanupTimer) {
    window.clearTimeout(cleanupTimer)
    cleanupTimer = undefined
  }
}

function setGlowRef(index: number, element: unknown): void {
  glowRefs.value[index] = element instanceof HTMLSpanElement ? element : null
}

function renderGlows(time: number): void {
  const elapsed = time / 1000

  HERO_GLOW_SPECS.forEach((glow, index) => {
    const element = glowRefs.value[index]

    if (!element) {
      return
    }

    const orbitAngle = elapsed * glow.speed + glow.phase
    const precession = elapsed * (glow.speed * 0.34) + glow.phase * 1.73
    const offsetX = Math.cos(orbitAngle) * glow.driftX + Math.cos(precession) * (glow.driftX * 0.42)
    const offsetY =
      Math.sin(orbitAngle) * glow.driftY + Math.sin(precession * 1.08) * (glow.driftY * 0.38)
    const scale =
      glow.scaleBase +
      Math.sin(elapsed * (glow.speed * 0.52) + glow.phase * 0.72) * glow.scaleAmp +
      Math.sin(elapsed * (glow.speed * 0.27) + glow.phase * 1.41) * (glow.scaleAmp * 0.46)
    const opacity = clamp(
      glow.opacityBase +
        Math.sin(elapsed * (glow.speed * 0.68) + glow.phase * 1.34) * glow.opacityAmp,
      0.3,
      1
    )
    const blur =
      glow.blur +
      Math.sin(elapsed * (glow.speed * 0.38) + glow.phase * 1.2) * 18 +
      Math.sin(elapsed * (glow.speed * 0.22) + glow.phase * 2.1) * 10
    const rotate = Math.sin(elapsed * (glow.speed * 0.31) + glow.phase * 0.83) * 10

    element.style.transform = `translate3d(calc(-50% + ${offsetX}%), calc(-50% + ${offsetY}%), 0) rotate(${rotate}deg) scale(${scale})`
    element.style.opacity = opacity.toFixed(3)
    element.style.filter = `blur(${blur.toFixed(1)}px)`
  })

  glowFrame = window.requestAnimationFrame(renderGlows)
}

function startGlowAnimation(): void {
  if (prefersReducedMotion.value) {
    return
  }

  stopGlowAnimation()
  glowFrame = window.requestAnimationFrame(renderGlows)
}

function stopGlowAnimation(): void {
  if (glowFrame) {
    window.cancelAnimationFrame(glowFrame)
    glowFrame = undefined
  }
}

function scheduleAutoplay(): void {
  clearAutoplay()

  if (prefersReducedMotion.value) {
    return
  }

  autoplayTimer = window.setTimeout(() => {
    advanceSlide()
  }, 5200)
}

function advanceSlide(): void {
  const nextIndex = (activeIndex.value + 1) % HERO_CAROUSEL_SLIDES.length

  if (prefersReducedMotion.value) {
    activeIndex.value = nextIndex
    scheduleAutoplay()
    return
  }

  if (outgoingIndex.value !== null) {
    return
  }

  clearCleanupTimer()
  outgoingIndex.value = activeIndex.value
  activeIndex.value = nextIndex
  slideIsAnimating.value = false

  void nextTick(() => {
    window.requestAnimationFrame(() => {
      incomingLayerRef.value?.getBoundingClientRect()
      slideIsAnimating.value = true
    })
  })

  cleanupTimer = window.setTimeout(() => {
    outgoingIndex.value = null
    slideIsAnimating.value = false
  }, GALLERY_TRANSITION_MS)

  scheduleAutoplay()
}

function handleMotionChange(event: MediaQueryListEvent): void {
  prefersReducedMotion.value = event.matches

  if (prefersReducedMotion.value) {
    outgoingIndex.value = null
    slideIsAnimating.value = false
    clearCleanupTimer()
    stopGlowAnimation()
  } else {
    startGlowAnimation()
  }

  scheduleAutoplay()
}

onMounted(() => {
  motionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = motionMediaQuery.matches
  motionMediaQuery.addEventListener('change', handleMotionChange)
  scheduleAutoplay()
  startGlowAnimation()
})

onBeforeUnmount(() => {
  clearAutoplay()
  clearCleanupTimer()
  stopGlowAnimation()
  motionMediaQuery?.removeEventListener('change', handleMotionChange)
})
</script>

<template>
  <figure class="site-hero-figure" aria-label="TemPad Dev product surfaces shown in the hero.">
    <div class="site-hero-shot-frame" aria-hidden="true">
      <div class="site-hero-shot-glows">
        <span
          v-for="(glow, index) in HERO_GLOW_SPECS"
          :key="glow.id"
          :ref="(element) => setGlowRef(index, element)"
          class="site-hero-glow"
          :style="{
            left: `${glow.centerX}%`,
            top: `${glow.centerY}%`,
            width: `${glow.width}%`,
            height: `${glow.height}%`,
            background: `radial-gradient(circle at center, rgb(${glow.rgb} / 0.42) 0%, rgb(${glow.rgb} / 0.2) 34%, rgb(${glow.rgb} / 0.08) 58%, transparent 80%)`
          }"
        />
      </div>

      <div
        v-if="outgoingSlide"
        :key="`outgoing-${outgoingSlide.id}`"
        class="site-hero-shot-layer is-outgoing"
        :class="{ 'is-animating': slideIsAnimating }"
      >
        <div class="site-hero-shot-media">
          <img
            class="site-hero-shot-image"
            :src="outgoingSlide.image"
            alt=""
            :style="{
              objectFit: outgoingSlide.objectFit ?? 'contain',
              objectPosition: outgoingSlide.objectPosition ?? 'center center'
            }"
          />
          <p class="site-hero-shot-caption">{{ outgoingSlide.caption }}</p>
        </div>
      </div>

      <div
        ref="incomingLayerRef"
        :key="`incoming-${activeSlide.id}`"
        class="site-hero-shot-layer is-incoming"
        :class="{
          'is-resting': !outgoingSlide,
          'is-animating': slideIsAnimating
        }"
      >
        <div class="site-hero-shot-media">
          <img
            class="site-hero-shot-image"
            :src="activeSlide.image"
            alt=""
            :style="{
              objectFit: activeSlide.objectFit ?? 'contain',
              objectPosition: activeSlide.objectPosition ?? 'center center'
            }"
          />
          <p class="site-hero-shot-caption">{{ activeSlide.caption }}</p>
        </div>
      </div>
    </div>
  </figure>
</template>
