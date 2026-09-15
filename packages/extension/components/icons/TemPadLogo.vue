<script setup lang="ts">
import { onScopeDispose, shallowRef, watch } from 'vue'

const props = defineProps<{ loading?: boolean }>()
const svg = shallowRef<SVGSVGElement | null>(null)
const phase = shallowRef<'idle' | 'loading' | 'finishing' | 'restoring'>(
  props.loading ? 'loading' : 'idle'
)
let settleTimer: ReturnType<typeof setTimeout> | undefined

function settled() {
  if (props.loading) return
  clearTimeout(settleTimer)
  phase.value = 'idle'
}

function restore() {
  if (phase.value !== 'finishing') return
  clearTimeout(settleTimer)
  phase.value = 'restoring'
  // Fallback for animation events suppressed by a hidden or removed surface.
  settleTimer = setTimeout(settled, 260)
}

watch(
  () => props.loading,
  (loading) => {
    clearTimeout(settleTimer)
    if (loading) {
      phase.value = 'loading'
    } else if (svg.value?.querySelector('.tp-logo-plane')?.getAnimations().length) {
      // Keep the current loop and its phase; restore only at its next boundary.
      phase.value = 'finishing'
      settleTimer = setTimeout(restore, 2100)
    } else {
      settled()
    }
  },
  { flush: 'post' }
)

onScopeDispose(() => clearTimeout(settleTimer))

// The source is two 240 × 300 rectangles in a y-sheared coordinate system.
// Their (120, 150) offset leaves an L after intersection removal. Preserve the
// source's five rounded corner runs, then move their vertices with the rectangle
// and intersection they belong to. The ±10px optical separation stays outside
// this calculation, so the rounded corners and intentional gap do not change.
const cornerRuns = [
  'M 76.000000 212.640891 C 76.000000 208.251181 76.000000 204.410185 78.376000 200.294833 C 80.752000 196.179480 84.078400 194.258982 87.880000 192.064127 L 280.360000 80.935747 C 291.764800 74.351183 301.744000 68.589689 308.872000 72.705042 C 316.000000 76.820395 316.000000 88.343382 316.000000 101.512511',
  'L 316.000000 196.641141 C 316.000000 201.030851 316.000000 204.871847 313.624000 208.987200 C 311.248000 213.102552 307.921600 215.023050 304.120000 217.217905',
  'L 206.395000 273.639460 C 203.068600 275.559958 200.158000 277.240394 198.079000 280.841327 C 196.000000 284.442261 196.000000 287.803132 196.000000 291.644128',
  'L 196.000000 415.923174 C 196.000000 420.312883 196.000000 424.153879 193.624000 428.269232 C 191.248000 432.384585 187.921600 434.305083 184.120000 436.499937',
  'L 111.640000 478.346285 C 100.235200 484.930849 90.256000 490.692343 83.128000 486.576990 C 76.000000 482.461638 76.000000 470.938650 76.000000 457.769521 Z'
]
const diagonalSlope = 300 / 240 - 1 / Math.sqrt(3)

function pathAt(inset: number): string {
  const diagonal = inset * diagonalSlope
  const crossCorner = inset * (300 / 240 + 1 / Math.sqrt(3))
  const offsets = [
    [inset, diagonal],
    [inset, -crossCorner],
    [-inset, -diagonal],
    [-inset, crossCorner],
    [inset, diagonal]
  ]
  return cornerRuns
    .map((run, index) => {
      let coordinate = 0
      const [dx, dy] = offsets[index]!
      return run.replace(/-?\d+(?:\.\d+)?/g, (value) =>
        (Number(value) + (coordinate++ % 2 === 0 ? dx! : dy!)).toFixed(6)
      )
    })
    .join(' ')
}

const restingPath = pathAt(0)
// The visible L arms range from 90 to 150 source units (120 at rest): ±25%.
// Move the outer plane and its cutout in opposite directions to expose the
// overlap change even at the 20px status-bar size.
const motion = {
  '--tp-logo-rest': `path("${restingPath}")`,
  '--tp-logo-inward': `path("${pathAt(15)}")`,
  '--tp-logo-outward': `path("${pathAt(-15)}")`
}
</script>

<template>
  <svg
    ref="svg"
    :class="{
      'tp-logo-loading': phase === 'loading' || phase === 'finishing',
      'tp-logo-restoring': phase === 'restoring'
    }"
    :style="motion"
    xmlns="http://www.w3.org/2000/svg"
    width="26"
    height="26"
    viewBox="0 0 512 512"
  >
    <g transform="translate(256 256) scale(.88) translate(-256 -320)">
      <path
        class="tp-logo-plane tp-logo-plane-first"
        :d="restingPath"
        fill="#7F61E4"
        transform="translate(-10 0)"
        @animationiteration="restore"
        @animationend="settled"
      />
      <path
        class="tp-logo-plane tp-logo-plane-second"
        :d="restingPath"
        fill="#3077EC"
        transform="translate(10 0) rotate(180 256 320)"
      />
    </g>
  </svg>
</template>

<style scoped>
.tp-logo-loading .tp-logo-plane {
  animation: tp-logo-overlap 2s cubic-bezier(0.45, 0, 0.2, 1) infinite;
}
.tp-logo-restoring .tp-logo-plane {
  animation: tp-logo-return 240ms cubic-bezier(0.22, 0.8, 0.25, 1) forwards;
}
@keyframes tp-logo-return {
  from {
    d: var(--tp-logo-outward);
  }
  to {
    d: var(--tp-logo-rest);
  }
}
@keyframes tp-logo-overlap {
  0%,
  100% {
    d: var(--tp-logo-outward);
  }
  45%,
  55% {
    d: var(--tp-logo-inward);
  }
}
@media (prefers-reduced-motion: reduce) {
  .tp-logo-loading .tp-logo-plane,
  .tp-logo-restoring .tp-logo-plane {
    animation: none;
  }
}
</style>
