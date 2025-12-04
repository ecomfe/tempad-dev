import type { AssetUploadedMessage } from '@/mcp-server/src/protocol'
import type { AssetDescriptor } from '@/mcp-server/src/tools'

import { MCP_ASSET_URI_PREFIX } from '@/mcp/shared/constants'

import { getMcpSocket } from './transport'

const uploadedAssets = new Map<string, AssetDescriptor>()
const inFlightUploads = new Map<string, Promise<AssetDescriptor>>()
const pendingAcks = new Map<
  string,
  {
    resolve: () => void
    reject: (error: Error) => void
  }
>()

export function buildAssetResourceUri(hash: string): string {
  return `${MCP_ASSET_URI_PREFIX}${hash}`
}

export function handleAssetUploaded(message: AssetUploadedMessage): void {
  const pending = pendingAcks.get(message.hash)
  if (!pending) {
    return
  }
  pendingAcks.delete(message.hash)

  if (message.ok) {
    pending.resolve()
  } else {
    pending.reject(new Error(message.error || 'Asset upload failed.'))
  }
}

export async function ensureAssetUploaded(
  bytes: Uint8Array,
  mimeType: string
): Promise<AssetDescriptor> {
  const hash = await hashBytes(bytes)
  const existing = uploadedAssets.get(hash)
  if (existing) {
    return existing
  }

  let uploadPromise = inFlightUploads.get(hash)
  if (!uploadPromise) {
    uploadPromise = upload(hash, bytes, mimeType)
    inFlightUploads.set(hash, uploadPromise)
  }

  const asset = await uploadPromise
  uploadedAssets.set(hash, asset)
  inFlightUploads.delete(hash)
  return asset
}

async function upload(hash: string, bytes: Uint8Array, mimeType: string) {
  const socket = getMcpSocket()
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('Cannot upload asset without an active MCP connection.')
  }

  const ack = createDeferred<void>()
  pendingAcks.set(hash, ack)

  const size = bytes.byteLength
  const meta = {
    type: 'assetUpload',
    hash,
    mime: mimeType,
    size
  }
  try {
    socket.send(JSON.stringify(meta))
    socket.send(toArrayBuffer(bytes))
  } catch (error) {
    pendingAcks.delete(hash)
    throw error instanceof Error
      ? error
      : new Error('Failed to transmit asset payload to MCP transport.')
  }

  await ack.promise

  const descriptor: AssetDescriptor = {
    hash,
    mimeType,
    size,
    resourceUri: buildAssetResourceUri(hash),
    url: buildAssetResourceUri(hash)
  }

  return descriptor
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (typeof crypto?.subtle?.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
    return bufferToHex(new Uint8Array(digest))
  }
  throw new Error('crypto.subtle.digest is unavailable in this environment.')
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer
  const isArrayBuffer = typeof ArrayBuffer !== 'undefined' && buffer instanceof ArrayBuffer
  if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength && isArrayBuffer) {
    return buffer
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
