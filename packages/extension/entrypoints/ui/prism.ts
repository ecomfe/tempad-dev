import waitFor from 'p-wait-for'

export const PRISM_LANGUAGES_READY_EVENT = 'tempad:prism-languages-ready'

const EXTRA_LANG_LOADERS = [
  () => import('prismjs/components/prism-sass'),
  () => import('prismjs/components/prism-scss'),
  () => import('prismjs/components/prism-less'),
  () => import('prismjs/components/prism-stylus'),
  () => import('prismjs/components/prism-css-extras')
]

export async function loadPrismLanguages() {
  await waitFor(() => window.Prism != null)

  for (const load of EXTRA_LANG_LOADERS) {
    await load()
  }

  window.dispatchEvent(new CustomEvent(PRISM_LANGUAGES_READY_EVENT))
}
