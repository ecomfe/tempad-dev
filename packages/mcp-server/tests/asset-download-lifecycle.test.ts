import type { IncomingMessage } from 'node:http'

import { createHash } from 'node:crypto'
import { createReadStream, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

import type { AssetStore } from '../src/asset-store'

import { createAssetHttpServer } from '../src/asset-http-server'
import { ASSET_DIR } from '../src/shared'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

it('closes source files after cancelled downloads and still serves a complete download', async () => {
  const hash = 'a'.repeat(64)
  const filePath = join(ASSET_DIR, `${hash}.png`)
  const content = Buffer.alloc(8 * 1024 * 1024, 42)
  writeFileSync(filePath, content)
  const store = {
    get: () => ({ hash, filePath, mimeType: 'image/png' }),
    touch: vi.fn()
  } as unknown as AssetStore
  const server = createAssetHttpServer(store)
  const streams = vi.mocked(createReadStream)
  await server.start()
  const url = `${server.getBaseUrl()}/assets/${hash}.png`
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        get(url, (res) => {
          res.pause()
          resolve(res)
        }).on('error', reject)
      })
      const source = streams.mock.results.at(-1)!.value as ReturnType<typeof createReadStream>
      response.destroy()
      await expect.poll(() => source.closed).toBe(true)
      expect(source.bytesRead).toBeLessThan(content.length)
    }
    const response = await fetch(url)
    const downloaded = Buffer.from(await response.arrayBuffer())
    expect(downloaded.length).toBe(content.length)
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(
      createHash('sha256').update(content).digest('hex')
    )
    await expect.poll(() => streams.mock.results.every(({ value }) => value.closed)).toBe(true)
  } finally {
    for (const { value } of streams.mock.results) value.destroy()
    server.stop()
    rmSync(filePath, { force: true })
  }
})
