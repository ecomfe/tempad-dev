import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const SKILLS = ['design-in-figma', 'figma-design-to-code']
const STANDARD = 'agent-plugin/targets/standard'
const PLUGINS_CLI = 'agent-plugin/targets/plugins-cli'
const CODEX = 'agent-plugin/targets/codex'
const CLAUDE = 'agent-plugin/targets/claude'
const DEV = '.dev/plugins/tempad-dev-dev'
const { runtimeSourceHash } = await import(
  pathToFileURL(join(repository, 'packages/mcp-server/scripts/runtime-source-hash.mjs')).href
)

let root: string

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary generated manifests
function read(path: string): any {
  return JSON.parse(readFileSync(join(root, path), 'utf8'))
}

function sourceFile(path: string): string {
  return readFileSync(join(root, 'agent-plugin/src', path), 'utf8')
}

function has(...path: string[]): boolean {
  return existsSync(join(root, ...path))
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tempad-plugin-packaging-')))
  for (const path of [
    'scripts/build-agent-plugin.mjs',
    'scripts/native-runtime-fixture.mjs',
    'packages/mcp-server/scripts/runtime-source-hash.mjs',
    'agent-plugin/src',
    'packages/extension/public/icon-128.png',
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json'
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(repository, path), join(root, path), { recursive: true })
  }
  execFileSync(process.execPath, [join(root, 'scripts/build-agent-plugin.mjs')])
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

it('points each host marketplace at its own distribution', () => {
  expect(read('.plugin/marketplace.json').plugins[0].source).toBe(`./${PLUGINS_CLI}`)
  expect(read('.agents/plugins/marketplace.json').plugins[0].source.path).toBe(`./${CODEX}`)
  expect(read('.claude-plugin/marketplace.json').plugins[0].source).toBe(`./${CLAUDE}`)
  expect(read('.dev/.agents/plugins/marketplace.json').plugins[0].source.path).toBe(
    './plugins/tempad-dev-dev'
  )
  expect(read('.dev/.claude-plugin/marketplace.json').plugins[0].source).toBe(
    './plugins/tempad-dev-dev'
  )
})

it('gives the standard distribution only the Agent Plugins layout', () => {
  expect(read(join(STANDARD, 'plugin.json'))).toEqual(JSON.parse(sourceFile('plugin.json')))
  expect(read(join(STANDARD, 'mcp.json'))).toEqual(JSON.parse(sourceFile('mcp.json')))
  // A standard consumer projects this manifest onto the host itself, so a host layout beside it
  // would be a second source of truth for the same package.
  for (const path of ['.plugin', '.claude-plugin', '.codex-plugin', '.mcp.json', 'clients']) {
    expect(has(STANDARD, path)).toBe(false)
  }
})

it.each([PLUGINS_CLI, CODEX, CLAUDE, DEV])('omits the standard manifests from %s', (target) => {
  for (const portable of ['plugin.json', 'mcp.json']) {
    expect(has(target, portable)).toBe(false)
  }
  expect(read(join(target, '.mcp.json')).mcpServers).toBeTypeOf('object')
})

it('gives the plugins CLI its supported format without native host hooks', () => {
  const manifest = read(join(PLUGINS_CLI, '.plugin/plugin.json'))
  expect(manifest.name).toBe('tempad-dev')
  expect(manifest).not.toHaveProperty('hooks')
  for (const path of ['.claude-plugin', '.codex-plugin', 'clients']) {
    expect(has(PLUGINS_CLI, path)).toBe(false)
  }
  for (const target of [CODEX, CLAUDE, DEV]) expect(has(target, '.plugin')).toBe(false)
})

it('gives the Codex distribution its interface and no hook payload', () => {
  const codex = read(join(CODEX, '.codex-plugin/plugin.json'))
  expect(codex.interface).toEqual(JSON.parse(sourceFile('clients/codex/interface.json')))
  expect(codex.skills).toBe('./skills/')
  // Codex binds task identity over native IPC, so it registers no hooks and ships no hook payload.
  expect(codex).not.toHaveProperty('hooks')
  expect(has(CODEX, 'clients')).toBe(false)
  expect(has(CODEX, '.claude-plugin')).toBe(false)
})

it('gives the Claude distribution its hooks and no Codex layout', () => {
  const claude = read(join(CLAUDE, '.claude-plugin/plugin.json'))
  expect(claude.hooks).toBe('./clients/claude/hooks.json')
  const hooks = read(join(CLAUDE, claude.hooks)).hooks
  for (const event of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
    expect(hooks[event][0].hooks[0].command).toContain('lifecycle.mjs" claude')
  }
  expect(hooks.PostToolUse[0].matcher).toBe('mcp__.*tempad.*')
  expect(hooks.PreToolUse[0]).not.toHaveProperty('matcher')
  expect(readFileSync(join(root, CLAUDE, 'clients/shared/lifecycle.mjs'), 'utf8')).toBe(
    sourceFile('clients/shared/lifecycle.mjs')
  )
  expect(has(CLAUDE, '.codex-plugin')).toBe(false)
})

it.each([CLAUDE, DEV])(
  'ships an independently importable lifecycle and runtime discovery helper in %s',
  (target) => {
    const shared = join(root, target, 'clients/shared')
    expect(readFileSync(join(shared, 'runtime-paths.mjs'), 'utf8')).toBe(
      sourceFile('clients/shared/runtime-paths.mjs')
    )
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'const { resolveDefaultRoot } = await import(process.argv[1]); console.log(resolveDefaultRoot("/tmp/packaged-runtime", "darwin"))',
        pathToFileURL(join(shared, 'runtime-paths.mjs')).href
      ],
      { encoding: 'utf8' }
    )
    expect(output.trim()).toBe(join('/tmp/packaged-runtime', 'tempad-dev'))
    expect(
      execFileSync(process.execPath, [join(shared, 'lifecycle.mjs'), 'claude'], {
        input: '{}',
        encoding: 'utf8'
      })
    ).toBe('')
  }
)

it('keeps one shared identity across every distribution', () => {
  const identity = ({ name, version, description }: Record<string, unknown>) => ({
    name,
    version,
    description
  })
  const source = read('agent-plugin/src/plugin.json')
  expect(identity(read(join(STANDARD, 'plugin.json')))).toEqual(identity(source))
  expect(identity(read(join(PLUGINS_CLI, '.plugin/plugin.json')))).toEqual(identity(source))
  expect(identity(read(join(CODEX, '.codex-plugin/plugin.json')))).toEqual(identity(source))
  expect(identity(read(join(CLAUDE, '.claude-plugin/plugin.json')))).toEqual(identity(source))
})

it.each([STANDARD, PLUGINS_CLI, CODEX, CLAUDE, DEV])(
  'copies every shared skill verbatim into %s',
  (target) => {
    expect(has(target, 'skills', 'figma-canvas-authoring')).toBe(target === STANDARD)
    for (const skill of SKILLS) {
      const content = readFileSync(join(root, target, 'skills', skill, 'SKILL.md'), 'utf8')
      expect(content).toBe(sourceFile(join('skills', skill, 'SKILL.md')))
      expect(content.split('\n---\n', 1)[0]?.match(/^name: (.+)$/m)?.[1]).toBe(skill)
      expect(has(target, 'skills', skill, 'assets/icon.svg')).toBe(true)
    }
    expect(has(target, 'assets/icon.png')).toBe(true)
  }
)

it('derives the standalone compatibility skill from the current authoring skill', () => {
  const alias = join(STANDARD, 'skills/figma-canvas-authoring')
  const content = readFileSync(join(root, alias, 'SKILL.md'), 'utf8')
  expect(content.split('\n---\n', 1)[0]?.match(/^name: (.+)$/m)?.[1]).toBe('figma-canvas-authoring')
  expect(content).toContain(
    'Use only when design-in-figma is not installed; otherwise use design-in-figma.'
  )
  expect(content.split('\n---\n')[1]).toBe(
    sourceFile('skills/design-in-figma/SKILL.md').split('\n---\n')[1]
  )
  expect(readFileSync(join(root, alias, 'references/canvas-html.md'), 'utf8')).toBe(
    sourceFile('skills/design-in-figma/references/canvas-html.md')
  )
})

it('pins releases to npm and the development build to this checkout', () => {
  for (const target of [PLUGINS_CLI, CODEX, CLAUDE]) {
    expect(read(join(target, '.mcp.json')).mcpServers['tempad-dev'].args).toEqual([
      '-y',
      '@tempad-dev/mcp@latest'
    ])
  }
  expect(read(join(DEV, '.mcp.json')).mcpServers['tempad-dev-dev'].args).toEqual([
    join(root, 'packages/mcp-server/dist/cli.mjs')
  ])
  // One development package is installable from either host while testing.
  expect(read(join(DEV, '.codex-plugin/plugin.json')).interface.displayName).toBe(
    'TemPad Dev (Dev)'
  )
  expect(read(join(DEV, '.claude-plugin/plugin.json')).hooks).toBe('./clients/claude/hooks.json')
  const profile = read(join(DEV, 'clients/shared/runtime-profile.json'))
  expect(profile).toEqual({
    checkout: root,
    id: expect.stringMatching(/^[a-f0-9]{16}$/),
    serverName: read(join(DEV, '.claude-plugin/plugin.json')).name
  })
  expect(read(join(DEV, '.claude-plugin/plugin.json')).mcpServers).toBe('./.mcp.json')
  expect(Object.keys(read(join(DEV, '.mcp.json')).mcpServers)).toEqual([profile.serverName])
  const hooks = read(join(DEV, 'clients/claude/hooks.json')).hooks
  expect(hooks.Stop[0].hooks[0].command).toContain(
    '--runtime-profile "${CLAUDE_PLUGIN_ROOT}/clients/shared/runtime-profile.json"'
  )
  expect(has(CLAUDE, 'clients/shared/runtime-profile.json')).toBe(false)
})

it('gives Codex enough time to receive the bounded canvas outcome', () => {
  const settings = JSON.parse(sourceFile('clients/codex/mcp.json'))
  expect(settings.tool_timeout_sec).toBe(300)
  expect(read(join(CODEX, '.mcp.json')).mcpServers['tempad-dev'].tool_timeout_sec).toBe(300)
  expect(read(join(DEV, '.mcp.json')).mcpServers['tempad-dev-dev'].tool_timeout_sec).toBe(300)
  for (const target of [CLAUDE, PLUGINS_CLI]) {
    expect(read(join(target, '.mcp.json')).mcpServers['tempad-dev']).not.toHaveProperty(
      'tool_timeout_sec'
    )
  }
  expect(read(join(STANDARD, 'mcp.json')).mcpServers['tempad-dev']).not.toHaveProperty(
    'tool_timeout_sec'
  )
})

it('limits the native runtime fixture to the ignored plugin and routes both hosts to it', () => {
  for (const path of [
    'packages/mcp-server/package.json',
    'packages/mcp-server/tsdown.config.ts',
    'packages/mcp-server/scripts/runtime-contract.mjs',
    'packages/mcp-server/src/probe.ts',
    'packages/shared/src/probe.ts',
    'pnpm-lock.yaml'
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), '{}\n')
  }
  const fixtureRoot = realpathSync(mkdtempSync(join(root, 'native-fixture-')))
  const registryUrl = 'http://127.0.0.1:34567'
  const artifacts = ['0.12.0', '0.12.1'].map((version) => {
    const directory = join(fixtureRoot, version)
    mkdirSync(directory)
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        name: '@tempad-dev/mcp',
        version,
        private: true,
        publishConfig: { registry: registryUrl }
      })
    )
    return { version, directory, integrity: `sha512-${Buffer.alloc(64).toString('base64')}` }
  })
  const fixture = {
    version: 1,
    kind: 'native-runtime-fixture',
    testOnly: true,
    checkout: root,
    sourceHash: runtimeSourceHash(root),
    root: fixtureRoot,
    registryUrl,
    env: {
      TEMPAD_MCP_RUNTIME_DIR: join(fixtureRoot, 'run'),
      TEMPAD_MCP_STATE_DIR: join(fixtureRoot, 'state'),
      TEMPAD_MCP_ASSET_DIR: join(fixtureRoot, 'assets'),
      TEMPAD_MCP_LOG_DIR: join(fixtureRoot, 'logs')
    },
    initial: artifacts[0],
    candidate: artifacts[1]
  }
  const descriptor = join(fixtureRoot, 'runtime-fixture.json')
  writeFileSync(descriptor, JSON.stringify(fixture), { mode: 0o600 })
  const released = [join(CODEX, '.mcp.json'), join(CLAUDE, 'clients/claude/hooks.json')]
  const before = released.map((path) => read(path))
  try {
    execFileSync(process.execPath, [
      join(root, 'scripts/build-agent-plugin.mjs'),
      '--runtime-fixture',
      descriptor
    ])
    expect(released.map((path) => read(path))).toEqual(before)
    expect(read(join(DEV, '.mcp.json')).mcpServers['tempad-dev-dev']).toEqual({
      command: 'node',
      args: [join(artifacts[0]!.directory, 'dist/cli.mjs'), '--runtime-updates=stable'],
      tool_timeout_sec: 300,
      env: fixture.env
    })
    expect(read(join(DEV, 'runtime-fixture.json'))).toEqual({ descriptor })
    expect(has(DEV, 'clients/shared/runtime-profile.json')).toBe(false)
    expect(read(join(DEV, 'clients/claude/hooks.json')).hooks.Stop[0].hooks[0].command).toBe(
      `TEMPAD_MCP_RUNTIME_DIR='${fixture.env.TEMPAD_MCP_RUNTIME_DIR}' node "\${CLAUDE_PLUGIN_ROOT}/clients/shared/lifecycle.mjs" claude`
    )
    writeFileSync(join(root, 'packages/mcp-server/src/probe.ts'), 'changed source')
    expect(() =>
      execFileSync(
        process.execPath,
        [join(root, 'scripts/build-agent-plugin.mjs'), '--runtime-fixture', descriptor],
        { stdio: 'pipe' }
      )
    ).toThrow(/Native fixture sources changed/)
    expect(released.map((path) => read(path))).toEqual(before)
  } finally {
    execFileSync(process.execPath, [join(root, 'scripts/build-agent-plugin.mjs')])
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
  expect(has(DEV, 'runtime-fixture.json')).toBe(false)
})
