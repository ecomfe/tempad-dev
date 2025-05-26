export function transformHTML(html: string, transform: (frag: DocumentFragment) => void): string {
  const template = document.createElement('template')
  template.innerHTML = html

  transform(template.content)

  return template.innerHTML
}
