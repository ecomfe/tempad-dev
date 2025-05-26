import { evaluate } from '@/utils'
import waitFor from 'p-wait-for'

const EXTRA_LANGS = ['sass', 'scss', 'less', 'stylus', 'css-extras'] as const

// We are importing this in this way is because if we use
// `import('prismjs/components/prism-sass')` Rollup will not resolve it correctly
// with our current setup.
async function load(lang: (typeof EXTRA_LANGS)[number]) {
  const response = await fetch(
    `https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-${lang}.min.js`
  )
  return await response.text()
}

Promise.all([waitFor(() => window.Prism != null), ...EXTRA_LANGS.map((lang) => load(lang))]).then(
  ([, ...scripts]) => {
    scripts.forEach((script) => {
      evaluate(script)
    })
  }
)

export {}
