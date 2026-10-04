import type { McpClientId } from '../mcp/install'

import ampMono from './assets/amp-mono.svg?raw'
import amp from './assets/amp.svg?raw'
import antigravityMono from './assets/antigravity-mono.svg?raw'
import antigravity from './assets/antigravity.svg?raw'
import augment from './assets/augment.svg?raw'
import claudeMono from './assets/claude-mono.svg?raw'
import claude from './assets/claude.svg?raw'
import cline from './assets/cline.svg?raw'
import codebuddyMono from './assets/codebuddy-mono.svg?raw'
import codebuddy from './assets/codebuddy.svg?raw'
import codexMono from './assets/codex-mono.svg?raw'
import codex from './assets/codex.svg?raw'
import cursor from './assets/cursor.svg?raw'
import droid from './assets/droid.svg?raw'
import geminiMono from './assets/gemini-mono.svg?raw'
import gemini from './assets/gemini.svg?raw'
import copilot from './assets/github-copilot.svg?raw'
import hermes from './assets/hermes-agent.svg?raw'
import junieMono from './assets/junie-mono.svg?raw'
import junie from './assets/junie.svg?raw'
import kilo from './assets/kilo.svg?raw'
import kimiMono from './assets/kimi-code-cli-mono.svg?raw'
import kimi from './assets/kimi-code-cli.svg?raw'
import kiroMono from './assets/kiro-cli-mono.svg?raw'
import kiro from './assets/kiro-cli.svg?raw'
import opencode from './assets/opencode.svg?raw'
import pi from './assets/pi.svg?raw'
import qoderMono from './assets/qoder-mono.svg?raw'
import qoder from './assets/qoder.svg?raw'
import qwenMono from './assets/qwen-code-mono.svg?raw'
import qwen from './assets/qwen-code.svg?raw'
import traeMono from './assets/trae-mono.svg?raw'
import trae from './assets/trae.svg?raw'
import vscodeMono from './assets/vscode-mono.svg?raw'
import vscode from './assets/vscode.svg?raw'
import zcode from './assets/zcode.svg?raw'
import zed from './assets/zed.svg?raw'

export type { McpClientId } from '../mcp/install'

export const MCP_CLIENT_BRAND_SVGS = {
  amp,
  antigravity,
  augment,
  cline,
  codebuddy,
  droid,
  'github-copilot': copilot,
  'hermes-agent': hermes,
  junie,
  kilo,
  'kimi-code-cli': kimi,
  'kiro-cli': kiro,
  pi,
  qoder,
  'qwen-code': qwen,
  zcode,
  zed,
  vscode,
  cursor,
  claude,
  codex,
  gemini,
  opencode,
  trae
} satisfies Record<McpClientId, string>

const MONOCHROME_BRAND_SVGS: Partial<Record<McpClientId, string>> = {
  amp: ampMono,
  antigravity: antigravityMono,
  claude: claudeMono,
  codebuddy: codebuddyMono,
  codex: codexMono,
  gemini: geminiMono,
  junie: junieMono,
  'kimi-code-cli': kimiMono,
  'kiro-cli': kiroMono,
  qoder: qoderMono,
  'qwen-code': qwenMono,
  trae: traeMono,
  vscode: vscodeMono
}

export function getMcpClientBrandSvg(id: McpClientId, monochrome = false): string {
  if (monochrome) return MONOCHROME_BRAND_SVGS[id] ?? MCP_CLIENT_BRAND_SVGS[id]
  return MCP_CLIENT_BRAND_SVGS[id]
}
