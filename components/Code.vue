<script setup lang="ts">
import { useCopy } from '@/composables'
import { transformHTML } from '@/utils/dom'

import IconButton from './IconButton.vue'
import Copy from './icons/Copy.vue'

const props = defineProps<{
  title: string
  lang: string
  code: string
  link?: string
}>()

const prismAlias: Record<string, string> = {
  vue: 'html'
}

const lang = computed(() => {
  if (prismAlias[props.lang]) {
    return prismAlias[props.lang]
  }

  return props.lang
})

const highlighted = computed(() => {
  const { Prism } = window
  if (!Prism || !Prism.languages[lang.value]) {
    return props.code
  }

  const html = Prism.highlight(props.code, Prism.languages[lang.value], lang.value)

  return transformHTML(html, (tpl) => {
    tpl.querySelectorAll<HTMLElement>('.token.variable, .token.constant').forEach((el) => {
      el.setAttribute('tabindex', '0')
      el.classList.add('copyable')
      el.dataset.tooltipType = 'text'
      el.dataset.tooltip = 'Copy'
      el.innerHTML = `<span>${el.innerHTML}</span>`
    })

    tpl.querySelectorAll('.token.number + .token.unit').forEach((el) => {
      const span = document.createElement('span')
      span.className = 'token dimension'
      el.parentNode!.insertBefore(span, el.nextElementSibling)
      span.appendChild(el.previousElementSibling!)
      span.appendChild(el)
    })
  })
})

const code = computed(() => props.code)
const copy = useCopy(code)

function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.token.copyable')) {
    copy(target)
  }
}
</script>

<template>
  <section class="tp-code">
    <header class="tp-row tp-row-justify tp-code-header">
      {{ title }}
      <div class="tp-row tp-gap">
        <slot name="actions" />
        <IconButton variant="secondary" title="Copy" @click="copy">
          <Copy />
        </IconButton>
      </div>
    </header>
    <pre class="tp-code-content"><code v-html="highlighted" @click="handleClick"/></pre>
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

.tp-code-content .token.property {
  color: var(--color-text);
}

.tp-code-content .token.plain {
  color: var(--color-codevalue);
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

.tp-code-content .token.number,
.tp-code-content .token.unit {
  color: var(--color-codevalue);
}

.tp-code-content .token.copyable {
  text-decoration-line: underline;
  text-decoration-color: color-mix(in srgb, var(--color-codevariable) 50%, transparent);
  text-decoration-style: dashed;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  cursor: pointer;
  -webkit-user-select: text;
  user-select: text;
  background: transparent;
  display: unset;
}

.tp-code-content .token.copyable > span {
  line-height: 130%;
  background: transparent;
  border-radius: 4px;
  padding: 0 2px;
  margin: -2px;
}

.tp-code-content .token.copyable:hover > span {
  background: color-mix(in srgb, var(--color-codevariable) 15%, transparent);
}

.tp-code-content .token.copyable {
  outline: 2px solid transparent;
}

.tp-code-content .token.copyable:focus-visible {
  outline: 2px solid var(--color-border-selected);
  outline-offset: -2px;
}

.tp-code-content .token.variable:focus {
  outline: 2px solid var(--color-border-selected);
  outline-offset: -2px;
}

.tp-code-content .token.variable:focus:not(:focus-visible) {
  outline: 2px solid transparent;
}
</style>
