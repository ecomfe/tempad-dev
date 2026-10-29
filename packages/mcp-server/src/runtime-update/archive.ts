import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

import { IntegritySchema, safePath } from './manifest'

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
export const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILES = 20_000

export function verifyIntegrity(bytes: Uint8Array, integrity: string) {
  IntegritySchema.parse(integrity)
  if (
    bytes.byteLength > MAX_ARCHIVE_BYTES ||
    `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity
  )
    throw new Error('Runtime archive integrity or size check failed.')
}

function field(bytes: Buffer) {
  const end = bytes.indexOf(0)
  return new TextDecoder('utf-8', { fatal: true }).decode(
    bytes.subarray(0, end < 0 ? bytes.length : end)
  )
}
function octal(bytes: Buffer) {
  const text = field(bytes).trim()
  if (!/^[0-7]+$/.test(text)) throw new Error('Invalid tar numeric field.')
  const number = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(number)) throw new Error('Oversized tar numeric field.')
  return number
}
function pax(bytes: Buffer) {
  const result: Record<string, string> = Object.create(null)
  let offset = 0
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset)
    const length = Number(bytes.subarray(offset, space).toString('ascii'))
    if (
      space < offset ||
      !Number.isSafeInteger(length) ||
      length <= space - offset + 1 ||
      offset + length > bytes.length ||
      bytes[offset + length - 1] !== 10
    )
      throw new Error('Invalid tar extended header.')
    const record = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(space + 1, offset + length - 1)
    )
    const equals = record.indexOf('=')
    if (equals < 1) throw new Error('Invalid tar extended field.')
    const key = record.slice(0, equals)
    if (key in result || key === 'linkpath' || key.startsWith('GNU.sparse'))
      throw new Error('Unsafe tar extended field.')
    result[key] = record.slice(equals + 1)
    offset += length
  }
  return result
}

/** Parse before writing anything. Links, devices, traversal and duplicate files are forbidden. */
export function readArchive(compressed: Buffer): Map<string, Buffer> {
  if (compressed.length > MAX_ARCHIVE_BYTES) throw new Error('Runtime archive is too large.')
  const bytes = gunzipSync(compressed, { maxOutputLength: MAX_EXTRACTED_BYTES })
  const files = new Map<string, Buffer>()
  const directories = new Set<string>()
  let extended: Record<string, string> | undefined
  let offset = 0
  let ended = false
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    offset += 512
    if (header.every((value) => value === 0)) {
      if (extended || bytes.subarray(offset).some((value) => value !== 0))
        throw new Error('Trailing tar content.')
      ended = true
      break
    }
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0
    )
    if (octal(header.subarray(148, 156)) !== checksum) throw new Error('Invalid tar checksum.')
    const prefix = field(header.subarray(345, 500))
    const name = (prefix ? `${prefix}/` : '') + field(header.subarray(0, 100))
    const size = octal(header.subarray(124, 136))
    const type = String.fromCharCode(header[156]!)
    if (size > MAX_FILE_BYTES || offset + size > bytes.length)
      throw new Error('Invalid tar file size.')
    const data = bytes.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    if (type === 'x') {
      if (extended) throw new Error('Repeated tar extended header.')
      extended = pax(data)
      continue
    }
    const path = extended?.path ?? name
    if (extended?.size !== undefined && Number(extended.size) !== size)
      throw new Error('Conflicting tar sizes.')
    extended = undefined
    if (!['0', '\0', '5'].includes(type))
      throw new Error('Runtime archives may contain only regular files and directories.')
    if (!path.startsWith('package/')) throw new Error('Unexpected package archive root.')
    if (type !== '5' && path.endsWith('/')) throw new Error('Invalid regular file path.')
    const relative = path.slice(8).replace(/\/$/, '')
    if (type === '5' && !relative && size === 0) continue
    if (!safePath(relative) || files.has(relative))
      throw new Error('Unsafe or duplicate package path.')
    if (type === '5') {
      if (size !== 0) throw new Error('Nonempty tar directory.')
      directories.add(relative)
    } else {
      if (directories.has(relative)) throw new Error('Package file conflicts with directory.')
      files.set(relative, data)
    }
    if (files.size + directories.size > MAX_FILES) throw new Error('Too many package entries.')
  }
  if (!ended || !files.size) throw new Error('Incomplete package archive.')
  for (const path of [...files.keys(), ...directories]) {
    const parts = path.split('/')
    parts.pop()
    while (parts.length) {
      if (files.has(parts.join('/')))
        throw new Error('Package file is an ancestor of another entry.')
      parts.pop()
    }
  }
  return files
}
