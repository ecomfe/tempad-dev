declare module '*.md?raw' {
  const content: string
  export { content as default }
}
