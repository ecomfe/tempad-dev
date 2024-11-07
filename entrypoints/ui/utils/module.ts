export async function evaluate(code: string) {
  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  const module = await import(url)
  URL.revokeObjectURL(url)

  return module
}
