export function kebabToCamel(str: string) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function camelToKebab(str: string) {
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

export function snakeToKebab(str: string) {
  return str.replace(/_/g, '-').toLowerCase()
}
