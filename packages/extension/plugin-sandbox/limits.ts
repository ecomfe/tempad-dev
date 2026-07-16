export const PLUGIN_SANDBOX_LIMITS = {
  maxPayloadBytes: 4 * 1024 * 1024,
  maxPayloadDepth: 64,
  maxPayloadEntries: 100_000,
  maxQueuedRequests: 32,
  maxConcurrentWorkers: 4,
  requestTimeoutMs: 5000
} as const

type SandboxValueInspection =
  | { ok: true; bytes: number; entries: number }
  | { ok: false; reason: 'invalid-payload' | 'payload-too-large' }

const encoder = new TextEncoder()

export function inspectSandboxValue(value: unknown): SandboxValueInspection {
  const stack: Array<{ depth: number; exit?: boolean; value: unknown }> = [{ depth: 0, value }]
  const active = new WeakSet<object>()
  const seen = new WeakSet<object>()
  let bytes = 0
  let entries = 0

  while (stack.length) {
    const item = stack.pop()!
    if (item.depth > PLUGIN_SANDBOX_LIMITS.maxPayloadDepth) return tooLarge()

    const current = item.value
    if (item.exit && typeof current === 'object' && current !== null) {
      active.delete(current)
      continue
    }
    if (current == null || typeof current === 'undefined') {
      bytes += 4
    } else if (typeof current === 'boolean') {
      bytes += current ? 4 : 5
    } else if (typeof current === 'number') {
      if (!Number.isFinite(current)) return invalid()
      bytes += 8
    } else if (typeof current === 'string') {
      if (current.length > PLUGIN_SANDBOX_LIMITS.maxPayloadBytes - bytes) return tooLarge()
      bytes += encoder.encode(current).byteLength
    } else if (typeof current === 'object') {
      if (active.has(current)) return invalid()
      if (seen.has(current)) continue
      seen.add(current)
      active.add(current)
      stack.push({ depth: item.depth, exit: true, value: current })

      if (Array.isArray(current)) {
        entries += current.length
        if (entries > PLUGIN_SANDBOX_LIMITS.maxPayloadEntries) return tooLarge()
        for (let index = current.length - 1; index >= 0; index -= 1) {
          stack.push({ depth: item.depth + 1, value: current[index] })
        }
      } else {
        const prototype = Object.getPrototypeOf(current)
        if (prototype !== Object.prototype && prototype !== null) return invalid()
        const keys = Object.keys(current)
        entries += keys.length
        if (entries > PLUGIN_SANDBOX_LIMITS.maxPayloadEntries) return tooLarge()
        for (const key of keys) {
          if (key.length > PLUGIN_SANDBOX_LIMITS.maxPayloadBytes - bytes) return tooLarge()
          bytes += encoder.encode(key).byteLength
          stack.push({
            depth: item.depth + 1,
            value: (current as Record<string, unknown>)[key]
          })
        }
      }
    } else {
      return invalid()
    }

    if (bytes > PLUGIN_SANDBOX_LIMITS.maxPayloadBytes) return tooLarge()
  }

  return { ok: true, bytes, entries }
}

function invalid(): SandboxValueInspection {
  return { ok: false, reason: 'invalid-payload' }
}

function tooLarge(): SandboxValueInspection {
  return { ok: false, reason: 'payload-too-large' }
}
