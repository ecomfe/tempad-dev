<script setup lang="ts">
import { Braces, Layers, Terminal } from 'lucide-vue-next'

import BrandMark from '@/components/BrandMark.vue'
</script>

<template>
  <figure
    class="site-workflow-figure"
    aria-label="Illustration of editable Figma components and project code connected through your coding agent"
  >
    <div class="site-workflow-drawing" aria-hidden="true">
      <div class="site-workflow-surfaces">
        <div class="site-workflow-surface is-design">
          <div class="site-workflow-surface-title"><Layers /><span>Figma</span></div>
          <div class="site-design-canvas">
            <span class="site-design-layer-label">Button / Primary</span>
            <div class="site-design-selection">
              <span class="site-design-button">Save changes</span>
              <i /><i /><i /><i />
            </div>
            <span class="site-design-dimension">144 × 40</span>
          </div>
        </div>
        <div class="site-workflow-surface is-code">
          <div class="site-workflow-surface-title"><Braces /><span>Settings.vue</span></div>
          <div class="site-code-illustration">
            <div class="site-code-numbers">
              <span v-for="line in 12" :key="line">{{ line }}</span>
            </div>
            <pre><code><span class="is-punctuation">&lt;script setup&gt;</span>
<span class="is-keyword">import</span> { Button } <span class="is-keyword">from</span> <span class="is-value">'@/ui'</span>
<span class="is-keyword">import</span> { saveProfile } <span class="is-keyword">from</span> <span class="is-value">'@/profile'</span>
<span class="is-punctuation">&lt;/script&gt;</span>

<span class="is-punctuation">&lt;template&gt;</span>
  <span class="is-punctuation">&lt;</span><span class="is-component">Button</span> <span class="is-attribute">variant</span>=<span class="is-value">"primary"</span>
    <span class="is-attribute">@click</span>=<span class="is-value">"saveProfile"</span><span class="is-punctuation">&gt;</span>
    Save changes
  <span class="is-punctuation">&lt;/</span><span class="is-component">Button</span><span class="is-punctuation">&gt;</span>
<span class="is-punctuation">&lt;/template&gt;</span>
</code></pre>
          </div>
        </div>
      </div>
      <div class="site-workflow-connections" aria-hidden="true">
        <svg viewBox="0 0 560 80" fill="none">
          <path d="M112 0 V24 Q112 40 128 40 H264 Q280 40 280 56 V80" />
          <path d="M408 0 V24 Q408 40 392 40 H296 Q280 40 280 56 V80" />
          <path
            class="site-workflow-flow"
            pathLength="100"
            d="M112 0 V24 Q112 40 128 40 H264 Q280 40 280 56 V80"
          />
          <path
            class="site-workflow-flow is-project"
            pathLength="100"
            d="M408 0 V24 Q408 40 392 40 H296 Q280 40 280 56 V80"
          />
        </svg>
        <span class="site-workflow-bridge">Read &amp; edit</span>
        <span class="site-workflow-project">Build &amp; refine</span>
      </div>
      <div class="site-workflow-agent">
        <Terminal /><span>Your coding agent</span>
        <span class="site-workflow-agent-plugin" title="TemPad Dev plugin"><BrandMark /></span>
      </div>
    </div>
  </figure>
</template>
