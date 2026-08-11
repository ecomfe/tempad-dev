export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  tooLarge: () => Error
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maxBytes) throw tooLarge()

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw tooLarge()
    return bytes
  }

  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
