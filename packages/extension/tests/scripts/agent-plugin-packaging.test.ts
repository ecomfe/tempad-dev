import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))

it('builds hook-free Codex and native Claude packages while preserving the portable source', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tempad-plugin-packaging-')))
  const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
  try {
    for (const path of [
      'scripts/build-dev-agent-plugin.mjs',
      'agent-plugins/tempad-dev',
      'skill',
      'packages/extension/public/icon-128.png',
      '.agents/plugins/marketplace.json',
      '.claude-plugin/marketplace.json'
    ]) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      cpSync(join(repository, path), join(root, path), { recursive: true })
    }
    const source = read('agent-plugins/tempad-dev/plugin.json')
    execFileSync(process.execPath, [join(root, 'scripts/build-dev-agent-plugin.mjs')])
    expect(read('agent-plugins/tempad-dev/plugin.json')).toEqual(source)
    const nativePath = read('.agents/plugins/marketplace.json').plugins[0].source.path
    expect(read('.claude-plugin/marketplace.json').plugins[0].source).toBe(nativePath)
    const devPath = join(
      '.dev',
      read('.dev/.agents/plugins/marketplace.json').plugins[0].source.path
    )
    expect(read('.dev/.claude-plugin/marketplace.json').plugins[0].source).toBe(
      './plugins/tempad-dev-dev'
    )

    for (const path of [nativePath, devPath]) {
      // Native marketplace layouts remain independent of the portable manifest.
      expect(existsSync(join(root, path, 'plugin.json'))).toBe(false)
      const codex = read(join(path, '.codex-plugin/plugin.json'))
      const claude = read(join(path, '.claude-plugin/plugin.json'))
      expect(codex.name).toBe(claude.name)
      expect(codex.version).toBe(claude.version)
      expect(codex.mcpServers).toBe(claude.mcpServers)
      expect(codex).not.toHaveProperty('hooks')
      expect(existsSync(join(root, path, 'clients/codex/hooks.json'))).toBe(false)
      for (const [host, manifest] of [['claude', claude]] as const) {
        const hooks = read(join(path, manifest.hooks)).hooks
        for (const event of [
          'PreToolUse',
          'PostToolUse',
          'UserPromptSubmit',
          'Stop',
          'SessionEnd'
        ]) {
          expect(hooks[event][0].hooks[0].command).toContain(`lifecycle.mjs" ${host}`)
        }
      }
      expect(readFileSync(join(root, path, 'clients/shared/lifecycle.mjs'), 'utf8')).toBe(
        readFileSync(join(root, 'agent-plugins/tempad-dev/clients/shared/lifecycle.mjs'), 'utf8')
      )
      for (const skill of ['figma-canvas-authoring', 'figma-design-to-code']) {
        expect(readFileSync(join(root, path, 'skills', skill, 'SKILL.md'), 'utf8')).toBe(
          readFileSync(join(root, 'agent-plugins/tempad-dev/skills', skill, 'SKILL.md'), 'utf8')
        )
      }
    }
    expect(read(join(nativePath, '.mcp.json')).mcpServers['tempad-dev'].args).toEqual([
      '-y',
      '@tempad-dev/mcp@latest'
    ])
    expect(read(join(devPath, '.mcp.json')).mcpServers['tempad-dev-dev'].args).toEqual([
      join(root, 'packages/mcp-server/dist/cli.mjs')
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
