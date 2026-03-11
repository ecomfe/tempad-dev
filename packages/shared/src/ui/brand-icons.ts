import type { McpClientId } from '../mcp/install'

import claude from './assets/claude.svg?raw'
import codex from './assets/codex.svg?raw'
import cursor from './assets/cursor.svg?raw'
import trae from './assets/trae.svg?raw'
import vscode from './assets/vscode.svg?raw'
import windsurf from './assets/windsurf.svg?raw'

export const MCP_CLIENT_BRAND_SVGS = {
  vscode,
  cursor,
  windsurf,
  claude,
  codex,
  trae
} satisfies Record<McpClientId, string>

export function getMcpClientBrandSvg(id: McpClientId): string {
  return MCP_CLIENT_BRAND_SVGS[id]
}
