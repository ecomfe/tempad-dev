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

const content = useTemplateRef('content')
useScrollbar(content, {
  overflow: {
    y: 'hidden'
  },
  scrollbars: {
    autoHideDelay: 0,
    clickScroll: true
  }
})

const prismAlias: Record<string, string> = {
  vue: 'html'
}

const STRIP_TRAILING_WS_RE = /\s+$/gm

const code = computed(() => props.code.replace(STRIP_TRAILING_WS_RE, ''))

const lang = computed(() => {
  if (prismAlias[props.lang]) {
    return prismAlias[props.lang]
  }

  return props.lang
})

const highlighted = computed(() => {
  const { Prism } = window
  if (!Prism || !Prism.languages[lang.value]) {
    return code.value
  }

  const html = Prism.highlight(code.value, Prism.languages[lang.value], lang.value)

  return transformHTML(html, (tpl) => {
    tpl.querySelectorAll<HTMLElement>('.token.variable, .token.constant').forEach((el) => {
      el.setAttribute('tabindex', '0')
      el.classList.add('copyable')
      el.dataset.tooltipType = 'text'
      el.dataset.tooltip = 'Copy'
      el.innerHTML = `<span>${el.innerHTML}</span>`
    })

    tpl.querySelectorAll('.token.number + .token.unit').forEach((el) => {
      const prev = el.previousElementSibling!
      if (prev.nodeType !== Node.ELEMENT_NODE || !prev.classList.contains('number')) {
        return
      }

      const span = document.createElement('span')
      span.className = 'token dimension'
      el.parentNode!.insertBefore(span, el.nextSibling)
      span.appendChild(prev)
      span.appendChild(el)
    })

    tpl.querySelectorAll('.token.color').forEach((el) => {
      const span = document.createElement('span')
      span.className = 'token chit'
      span.style.backgroundColor = el.textContent || 'transparent'
      el.parentNode!.insertBefore(span, el)
    })
  })
})

const lines = computed(() => code.value.split('\n').length)
const copy = useCopy(code)

function handleCopy() {
  copy()
}

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
      <h3 class="tp-code-title">{{ title }}</h3>
      <div class="tp-row tp-gap">
        <slot name="actions" />
        <IconButton title="Copy" @click="handleCopy">
          <Copy />
        </IconButton>
      </div>
    </header>
    <div class="tp-code-block">
      <div class="tp-code-line-numbers">
        <div class="tp-code-line-number" v-for="i in lines" :key="i">{{ i }}</div>
      </div>
      <pre
        class="tp-code-content"
        ref="content"
      ><code v-html="highlighted" @click="handleClick"/></pre>
    </div>
  </section>
</template>

<style scoped>
.tp-code-header {
  width: 100%;
  min-height: 32px;
  border-radius: var(--radius-medium) var(--radius-medium) 0 0;
  padding: 0;
  background-color: var(--color-bg);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}

.tp-code-title {
  padding: 8px 0;
  font-weight: 400;
  color: var(--color-text);
  margin: 0;
}

.tp-code-block {
  display: flex;
  flex-direction: row;
  background-color: transparent;
  border-radius: var(--radius-medium, 2px);
  box-shadow: 0 0 0 1px var(--color-border-code-well);
  margin: 1px 0;
  padding: 8px 0 0;
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
}

.tp-code-line-numbers {
  display: flex;
  flex-direction: column;
  min-width: 20px;
  border-radius: 2px 0 0 2px;
  flex-shrink: 0;
  margin-top: -8px;
  padding-top: 8px;
  border-right: 1px solid var(--color-border-code-well);
}

.tp-code-line-number {
  min-width: 12px;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: end;
  padding-right: 4px;
  padding-left: 4px;
}

.tp-code-content {
  padding: 0 8px 8px;
  overflow-x: auto;
  user-select: text;
  cursor: text;
}

.tp-code-content :deep(.os-scrollbar) {
  cursor: default;
}

.tp-code-content:has(.os-scrollbar-visible) {
  padding-bottom: 16px;
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

.tp-code-content .token.plain,
.tp-code-content .token.color {
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

.tp-code-content .token.chit {
  width: 12px;
  height: 12px;
  display: inline-block;
  margin-right: 2px;
  transform: translateY(-1px);
  vertical-align: middle;
  border-radius: 2px;
  border: 1px solid var(--color-border);
  cursor: default;
}
</style>
