import { randomBytes, timingSafeEqual } from 'node:crypto'

const CHROME_EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/

export type ExtensionOriginPolicy = {
  exactOrigins: ReadonlySet<string>
  mode: 'any-extension' | 'exact'
}

export function createCapabilityToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createExtensionOriginPolicy(value: string | undefined): ExtensionOriginPolicy {
  const configuredOrigins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean)
  const invalidOrigin = configuredOrigins.find((origin) => !isChromeExtensionOrigin(origin))
  if (invalidOrigin) {
    throw new Error(`Invalid allowed extension Origin: ${invalidOrigin}`)
  }
  const exactOrigins = new Set(configuredOrigins)

  return {
    exactOrigins,
    mode: exactOrigins.size ? 'exact' : 'any-extension'
  }
}

export function isAllowedExtensionOrigin(
  origin: string | undefined,
  policy: ExtensionOriginPolicy
): boolean {
  if (!origin) return false
  const normalized = origin.toLowerCase()
  if (!isChromeExtensionOrigin(normalized)) return false
  return policy.mode === 'any-extension' || policy.exactOrigins.has(normalized)
}

export function isAllowedWebSocketRequest(
  origin: string | undefined,
  requestUrl: string | undefined,
  policy: ExtensionOriginPolicy
): boolean {
  if (!isAllowedExtensionOrigin(origin, policy)) return false
  if (!requestUrl) return false

  try {
    const baseUrl = 'ws://127.0.0.1'
    const url = new URL(requestUrl, baseUrl)
    return url.origin === baseUrl && url.pathname === '/' && url.search === ''
  } catch {
    return false
  }
}

export function secretsEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate)
  const expectedBuffer = Buffer.from(expected)
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  )
}

function isChromeExtensionOrigin(origin: string): boolean {
  return CHROME_EXTENSION_ORIGIN_PATTERN.test(origin)
}
