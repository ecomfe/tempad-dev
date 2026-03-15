declare module '*?skill-preview' {
  const preview: {
    frontmatterEntries: readonly {
      key: string
      value: string
    }[]
    html: string
    toc: readonly {
      depth: number
      id: string
      text: string
    }[]
  }

  export default preview
}
