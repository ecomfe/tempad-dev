import type { McpClientId } from '../mcp/install'

import claude from './assets/claude.svg?raw'
import codex from './assets/codex.svg?raw'
import cursor from './assets/cursor.svg?raw'
import gemini from './assets/gemini.svg?raw'
import opencode from './assets/opencode.svg?raw'
import trae from './assets/trae.svg?raw'
import vscode from './assets/vscode.svg?raw'

export type { McpClientId } from '../mcp/install'

export const MCP_CLIENT_BRAND_SVGS = {
  vscode,
  cursor,
  claude,
  codex,
  gemini,
  opencode,
  trae
} satisfies Record<McpClientId, string>

export function getMcpClientBrandSvg(id: McpClientId): string {
  return MCP_CLIENT_BRAND_SVGS[id]
}
