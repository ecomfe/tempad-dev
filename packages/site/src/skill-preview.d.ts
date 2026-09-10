declare module '*?skill-preview' {
  const preview: {
    entry: string
    files: readonly {
      path: string
      sourceUrl: string
      source: string
      metadataEntries: readonly {
        key: string
        value: string
      }[]
      html: string
      toc: readonly {
        depth: number
        id: string
        text: string
      }[]
    }[]
  }

  export default preview
}
