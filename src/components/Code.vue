<script lang="ts" setup>
import { computed, toRef } from 'vue'
import { useCopy } from '@/entrypoints/ui/composables/copy'
import IconButton from './IconButton.vue'
import Copy from './icons/Copy.vue'

const props = defineProps<{
  title: string
  lang: string
  code: string
  link?: string
}>()

const highlighted = computed(() => {
  const { Prism } = window
  if (!Prism) {
    return props.code
  }

  return Prism.highlight(props.code, Prism.languages[props.lang], props.lang)
})

const copy = useCopy(toRef(props.code))
</script>

<template>
  <section class="tp-code">
    <header class="tp-row tp-row-justify tp-code-header">
      {{ props.title }}
      <div class="tp-row">
        <slot name="actions" />
        <IconButton variant="secondary" title="Copy" @click="copy">
          <Copy />
        </IconButton>
      </div>
    </header>
    <pre class="tp-code-content"><code v-html="highlighted"/></pre>
  </section>
</template>

<style scoped>
.tp-code {
  border-radius: 2px;
  background-color: var(--color-bg-secondary);
}

.tp-code-header {
  height: 40px;
  padding: 4px 4px 4px 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  user-select: none;
  cursor: default;
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.tp-code-content {
  border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.1));
  padding: 4px 12px;
  -webkit-font-smoothing: antialiased;
  font-family:
    Roboto Mono,
    Monaco,
    Courier New,
    monospace;
  font-weight: 400;
  line-height: 18px;
  font-size: 11px;
  letter-spacing: 0.005em;
  overflow-x: auto;
}

.tp-code-content::selection {
  background-color: var(--color-texthighlight, #0d99ff);
}
</style>

<style>
.tp-code-content {
  color: var(--color-codevalue);
}

.tp-code-content .token {
  color: var(--color-text);
}

.tp-code-content .token.selector {
  color: var(--color-codeclassname);
}

.tp-code-content .token.function {
  color: var(--color-codeaccent);
}

.tp-code-content .token.string {
  color: var(--color-codestring);
}

.tp-code-content .token.comment {
  color: var(--color-codecomment);
}

.tp-code-content .token.url {
  color: var(--color-codevalue);
}

.tp-code-content .token.keyword {
  color: var(--color-codeaccent);
}

.tp-code-content .token.tag {
  color: var(--color-codetag);
}

.tp-code-content .token.tag .token.punctuation {
  color: var(--color-text);
}

.tp-code-content .token.attr-name {
  color: var(--color-codeattribute);
}

.tp-code-content .token.attr-value {
  color: var(--color-codeclassname);
}

.tp-code-content .token.boolean,
.highlight .token.number {
  color: var(--color-codevalue);
}
</style>
