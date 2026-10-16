import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'

const script = fileURLToPath(
  new URL('../../../../scripts/check-agent-plugin-version.mjs', import.meta.url)
)
let directory: string
const environment = { ...process.env }
// Git hooks can pass an absolute index or repository path. Keep every fixture
// command, including the checked script, isolated from the caller's repository.
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
  .trim()
  .split('\n')) {
  delete environment[name]
}

function git(...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Version Test',
      '-c',
      'user.email=version@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      `core.hooksPath=${join(directory, 'no-hooks')}`,
      ...args
    ],
    { cwd: directory, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
}

function write(path: string, content: string) {
  mkdirSync(dirname(join(directory, path)), { recursive: true })
  writeFileSync(join(directory, path), content)
}

function commit() {
  git('add', '.')
  git('commit', '-m', 'fixture', '--allow-empty')
  return git('rev-parse', 'HEAD')
}

function manifest(version: string) {
  write('agent-plugin/src/plugin.json', JSON.stringify({ name: 'test', version }))
}

function check(base: string) {
  return spawnSync(process.execPath, [script], {
    cwd: directory,
    env: { ...environment, PLUGIN_VERSION_BASE: base },
    encoding: 'utf8'
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tempad-plugin-version-'))
  git('init', '--quiet')
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it.each([
  'agent-plugin/src/skills/example/references/details.md',
  'agent-plugin/src/clients/claude/hooks.json',
  'agent-plugin/src/mcp.json',
  'agent-plugin/targets/codex/skills/example/SKILL.md',
  'agent-plugin/targets/standard/assets/icon.png'
])('requires a version increase for published payload %s', (path) => {
  manifest('0.5.1')
  const base = commit()
  write(path, 'changed')
  commit()
  expect(check(base)).toMatchObject({
    status: 1,
    stderr: expect.stringContaining('without a version increase')
  })
})

it.each(['0.5.2', '0.6.0', '1.0.0'])('accepts the stable version advance %s', (version) => {
  manifest('0.5.1')
  const base = commit()
  manifest(version)
  commit()
  expect(check(base).status).toBe(0)
})

it.each(['0.5.0', '0.4.99', '0.5.2-beta.1', '01.5.2'])(
  'rejects a downgrade or unsupported release version %s',
  (version) => {
    manifest('0.5.1')
    const base = commit()
    manifest(version)
    commit()
    expect(check(base).status).toBe(1)
  }
)

it('does not require a version increase for package prose or unchanged generator output', () => {
  manifest('0.5.1')
  const base = commit()
  for (const root of ['src', 'targets/standard', 'targets/codex'])
    for (const name of ['README.md', 'README.zh-Hans.md', 'CHANGELOG.md'])
      write(`agent-plugin/${root}/${name}`, 'updated prose')
  write('scripts/build-agent-plugin.mjs', '// refactored without changing payload')
  commit()
  expect(check(base).status).toBe(0)
})

it('checks deleted payload and rejects unreadable history', () => {
  manifest('0.5.1')
  write('agent-plugin/src/skills/example/SKILL.md', 'instructions')
  const base = commit()
  rmSync(join(directory, 'agent-plugin/src/skills/example/SKILL.md'))
  commit()
  expect(check(base).status).toBe(1)
  expect(check('missing-revision').status).toBe(1)
  expect(check('0000000000000000000000000000000000000000').status).toBe(1)
})

it('accepts initialization only against an empty plugin baseline', () => {
  write('README.md', 'repository')
  const empty = commit()
  expect(check('0000000000000000000000000000000000000000').status).toBe(0)
  manifest('0.1.0')
  commit()
  expect(check(empty).status).toBe(0)
})

it('accepts a plugin in the first commit but not an incomplete older plugin manifest', () => {
  manifest('0.1.0')
  commit()
  expect(check('0000000000000000000000000000000000000000').status).toBe(0)
  rmSync(join(directory, 'agent-plugin/src/plugin.json'))
  write('agent-plugin/src/skills/example/SKILL.md', 'legacy payload without a manifest')
  const incomplete = commit()
  manifest('0.1.0')
  commit()
  expect(check(incomplete).status).toBe(1)
})
