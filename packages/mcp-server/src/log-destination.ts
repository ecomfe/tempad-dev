import { closeSync, fstatSync, ftruncateSync, openSync, writeSync } from 'node:fs'
import { Writable } from 'node:stream'

export const MAX_LOG_BYTES = 10 * 1024 * 1024
const ROLLOVER = Buffer.from(
  '[tempad-dev/mcp] Log rolled over at 10 MiB; older entries discarded.\n'
)
const TRUNCATED = Buffer.from('\n[tempad-dev/mcp] Oversized log entry truncated.\n')

/** Runs inside the logging worker; one descriptor owns all writes and truncation. */
export function createLogDestination(path: string): Writable {
  const fd = openSync(path, 'a', 0o600)
  let size: number
  try {
    size = fstatSync(fd).size
  } catch (error) {
    closeSync(fd)
    throw error
  }

  function writeAll(bytes: Buffer): void {
    let offset = 0
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset)
      if (written <= 0) throw new Error('Log file write made no progress.')
      offset += written
      size += written
    }
  }

  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        if (size + chunk.length > MAX_LOG_BYTES) {
          ftruncateSync(fd, 0)
          size = 0
          writeAll(ROLLOVER)
        }
        if (size + chunk.length > MAX_LOG_BYTES) {
          let end = MAX_LOG_BYTES - size - TRUNCATED.length
          // The first omitted byte must not be a UTF-8 continuation byte.
          while ((chunk[end]! & 0xc0) === 0x80) end--
          writeAll(chunk.subarray(0, end))
          writeAll(TRUNCATED)
        } else {
          writeAll(chunk)
        }
        callback()
      } catch (error) {
        callback(error as Error)
      }
    },
    destroy(error, callback) {
      try {
        closeSync(fd)
        callback(error)
      } catch (closeError) {
        callback(error ?? (closeError as Error))
      }
    }
  })
}
