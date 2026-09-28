import { LegacyToolCallPayloadSchema, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

export function extensionUpgradeRequired(): Error & { code: string } {
  return Object.assign(
    new Error(
      'This operation requires a current TemPad Dev extension compatible with this Hub. Update the extension in ' +
        'Chrome, then reload the Figma tab and reconnect Agent integration. Until then, ' +
        'get_code, get_screenshot, and node-based get_structure remain available without a design task.'
    ),
    { code: TEMPAD_MCP_ERROR_CODES.EXTENSION_UPGRADE_REQUIRED }
  )
}

export function legacyToolPayload(name: string, args: unknown) {
  const result = LegacyToolCallPayloadSchema.safeParse({ name, args })
  if (!result.success) throw extensionUpgradeRequired()
  if (result.data.name === 'get_code' && result.data.args?.resolveTokens) {
    throw Object.assign(
      new Error(
        'resolveTokens requires matching current Hub and extension builds. Update the extension, ' +
          'then reload the Figma tab and reconnect Agent integration. Older extensions flatten ' +
          'token definitions and cannot return consumer-aware code with preserved aliases.'
      ),
      { code: TEMPAD_MCP_ERROR_CODES.EXTENSION_UPGRADE_REQUIRED }
    )
  }
  return result.data
}
