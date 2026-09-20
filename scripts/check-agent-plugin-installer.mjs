import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = mkdtempSync(join(tmpdir(), 'tempad-plugin-installer-'))
const target = 'agent-plugin/targets/plugins-cli'
const manifest = JSON.parse(readFileSync(join(root, 'agent-plugin/src/plugin.json'), 'utf8'))

try {
  // Retain the competing Claude marketplace but omit its package and the authored source.
  // Choosing the wrong entry must fail instead of discovering another copy of the plugin.
  for (const path of ['.plugin/marketplace.json', '.claude-plugin/marketplace.json', target]) {
    mkdirSync(dirname(join(fixture, path)), { recursive: true })
    cpSync(join(root, path), join(fixture, path), { recursive: true })
  }
  for (const path of [fixture, join(fixture, target)]) {
    const output = execFileSync('pnpm', ['dlx', 'plugins@1.3.4', 'discover', path], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
    })
    assert(output.includes('Found 1 local plugin(s)'), output)
    const entry = output.split('\n').find((line) => line.includes(`${manifest.name}  `))
    assert(entry?.includes('2 skills, mcp'), output)
    console.log(`plugins@1.3.4 discovered ${manifest.name} with both skills and MCP: ${path}`)
  }
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
