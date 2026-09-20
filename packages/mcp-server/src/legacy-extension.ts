import { LegacyToolCallPayloadSchema, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

export function extensionUpgradeRequired(): Error & { code: string } {
  return Object.assign(
    new Error(
      'This operation requires TemPad Dev extension 0.21.0 or later. Update the extension in ' +
        'Chrome, then reload the Figma tab and reconnect Agent integration. Until then, ' +
        'get_code, get_screenshot, and node-based get_structure remain available without a design task.'
    ),
    { code: TEMPAD_MCP_ERROR_CODES.EXTENSION_UPGRADE_REQUIRED }
  )
}

export function legacyToolPayload(name: string, args: unknown) {
  const result = LegacyToolCallPayloadSchema.safeParse({ name, args })
  if (!result.success) throw extensionUpgradeRequired()
  return result.data
}
