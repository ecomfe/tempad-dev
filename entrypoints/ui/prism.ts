const EXTRA_LANGS = ['sass', 'scss', 'less', 'stylus'] as const

// We are importing this in this way is because if we use
// `import('prismjs/components/prism-sass')` Rollup will not resolve it correctly
// with our current setup.
async function load(lang: (typeof EXTRA_LANGS)[number]) {
  const response = await fetch(
    `https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-${lang}.min.js`
  )
  const script = await response.text()
  evaluate(script)
}

EXTRA_LANGS.forEach((lang) => {
  load(lang)
})

export {}
