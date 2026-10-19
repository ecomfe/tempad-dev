import { execFileSync } from 'node:child_process'

const source = 'agent-plugin/src'
const targets = 'agent-plugin/targets'
const manifest = `${source}/plugin.json`

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trimEnd()
}

function isPayload(path) {
  return !/^agent-plugin\/(?:src|targets\/[^/]+)\/(?:README(?:\.zh-Hans)?|CHANGELOG)\.md$/.test(
    path
  )
}

function versionAt(revision) {
  const { version } = JSON.parse(git('show', `${revision}:${manifest}`))
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`${revision}:${manifest} must use a stable x.y.z release version.`)
  }
  return { value: version, parts: version.split('.').map(BigInt) }
}

function check() {
  const reference = process.argv[2] ?? process.env.PLUGIN_VERSION_BASE
  if (!reference) throw new Error('Provide a Git baseline: pnpm agent-plugin:check-version <base>.')
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error(
      'Cannot check agent plugin versions in a shallow checkout. Fetch full history with git fetch --unshallow, then rerun pnpm agent-plugin:check-version <base>.'
    )
  }
  const head = git('rev-parse', '--verify', 'HEAD^{commit}')
  let base
  if (/^0+$/.test(reference)) {
    if (git('rev-list', '--parents', '-n', '1', head).split(' ').length !== 1) {
      throw new Error(
        'An all-zero baseline is valid only for the initial commit; provide a readable Git baseline.'
      )
    }
  } else {
    try {
      base = git('rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`)
    } catch {
      throw new Error(
        `Git baseline "${reference}" is not available in this checkout. Fetch the missing commit or rerun pnpm agent-plugin:check-version <base> with an explicit readable baseline.`
      )
    }
  }
  const paths = base
    ? git('diff', '--name-only', '-z', '--no-renames', base, head, '--', source, targets)
    : git('ls-tree', '-r', '--name-only', '-z', head, '--', source, targets)
  if (!paths.split('\0').filter(Boolean).some(isPayload)) {
    console.log('Agent plugin payload is unchanged; no version increase required.')
    return
  }
  const current = versionAt(head)
  const previousFiles = base
    ? git('ls-tree', '-r', '--name-only', '-z', base, '--', source, targets)
        .split('\0')
        .filter(Boolean)
    : []
  if (!previousFiles.some(isPayload)) {
    console.log(`Agent plugin initialized at ${current.value}.`)
    return
  }
  const previous = versionAt(base)
  const differing = current.parts.findIndex((part, index) => part !== previous.parts[index])
  if (differing < 0 || current.parts[differing] < previous.parts[differing]) {
    throw new Error(
      `Agent plugin payload changed without a version increase (${previous.value} → ${current.value}). Bump ${manifest} and regenerate the targets.`
    )
  }
  console.log(`Agent plugin payload version advanced: ${previous.value} → ${current.value}.`)
}

try {
  check()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
