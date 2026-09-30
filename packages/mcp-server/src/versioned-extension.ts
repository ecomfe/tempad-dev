import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { getRecordProperty } from './shared'

const NODE_READS = new Set(['get_code', 'get_screenshot', 'get_structure'])

/** Preserve protocol 13's wire arguments; never silently strip a newer read option. */
export function assertVersionedToolSupport(
  protocolVersion: number,
  name: string,
  args: unknown
): void {
  if (protocolVersion !== 13) return
  const unsupported =
    (NODE_READS.has(name) && getRecordProperty(args, 'nodeIds') !== undefined) ||
    (name === 'get_structure' &&
      getRecordProperty(getRecordProperty(args, 'options'), 'depth') === 0) ||
    (name === 'get_code' && getRecordProperty(args, 'resolveTokens') === true)
  if (!unsupported) return
  throw Object.assign(
    new Error(
      'This read option requires TemPad Dev extension 0.23.0 or later. Update the extension and ' +
        'reload the Figma tab. Until then, use individual nodeId reads, positive structure depths, ' +
        'and unresolved token references. Existing sessions, design tasks, and canvas writes remain available.'
    ),
    { code: TEMPAD_MCP_ERROR_CODES.EXTENSION_UPGRADE_REQUIRED }
  )
}

export function versionedReadNotice(protocolVersion: number, name: string): string | undefined {
  if (protocolVersion !== 13) return undefined
  if (name === 'get_code' || name === 'get_token_defs') {
    return 'Protocol 13 compatibility: token metadata uses the installed extension’s original semantics; complete modes and alias dependencies are not guaranteed. Use exact nodeId reads for code. Upgrade the extension and reload Figma for consumer-aware resolution and complete definitions.'
  }
  if (name === 'get_structure' || name === 'get_screenshot') {
    return 'Protocol 13 compatibility: omitted nodeId uses the installed extension’s original selection behavior; structure may use a common ancestor. Use exact nodeId reads to preserve each requested root.'
  }
  return undefined
}
