// Test-only packaged runtimes for native-host acceptance. Never publish these archives.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import console from 'node:console'
import { appendFileSync } from 'node:fs'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { parseArgs, promisify } from 'node:util'

import { MCP_PORT_CANDIDATES } from '../../shared/src/mcp/constants.ts'
import { runtimeSourceHash } from './runtime-source-hash.mjs'

const exec = promisify(execFile)
const checkout = fileURLToPath(new URL('../../..', import.meta.url))
const source = join(checkout, 'packages/mcp-server')
const descriptorName = 'runtime-fixture.json'
const privateDirectories = {
  TEMPAD_MCP_RUNTIME_DIR: 'run',
  TEMPAD_MCP_STATE_DIR: 'state',
  TEMPAD_MCP_ASSET_DIR: 'assets',
  TEMPAD_MCP_LOG_DIR: 'logs'
}

export function fixtureEnvironment(root) {
  return Object.fromEntries(
    Object.entries(privateDirectories).map(([key, directory]) => [key, join(root, directory)])
  )
}

export function validateFixture(fixture, root) {
  assert.equal(fixture.version, 1)
  assert.equal(fixture.kind, 'native-runtime-fixture')
  assert.equal(fixture.testOnly, true)
  assert.equal(fixture.root, root)
  assert.ok(isAbsolute(fixture.checkout))
  assert.match(fixture.sourceHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(fixture.env, fixtureEnvironment(root))
  assert.deepEqual(fixture.releasePorts, MCP_PORT_CANDIDATES)
  const registry = new URL(fixture.registryUrl)
  assert.equal(registry.origin, fixture.registryUrl)
  assert.equal(registry.protocol, 'http:')
  assert.equal(registry.hostname, '127.0.0.1')
  assert.ok(Number(registry.port) > 0)
  assert.ok(!MCP_PORT_CANDIDATES.includes(Number(registry.port)))
  assert.equal(registry.username + registry.password, '')
  for (const release of [fixture.initial, fixture.candidate]) {
    assert.match(release.version, /^\d+\.\d+\.\d+$/)
    assert.equal(release.directory, join(root, 'packages', release.version))
    assert.equal(release.archive, join(root, 'archives', `mcp-${release.version}.tgz`))
    assert.match(release.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/)
  }
  const [major, minor, patch] = fixture.initial.version.split('.').map(Number)
  assert.equal(fixture.candidate.version, `${major}.${minor}.${patch + 1}`)
  return fixture
}

export function fixtureResponse(fixture, method, path, candidateAvailable = true) {
  if (method !== 'GET') return { status: 405 }
  const releases = candidateAvailable ? [fixture.initial, fixture.candidate] : [fixture.initial]
  const latest = releases.at(-1)
  const metadata = (release) => ({
    name: '@tempad-dev/mcp',
    version: release.version,
    dist: {
      integrity: release.integrity,
      tarball: `${fixture.registryUrl}/@tempad-dev/mcp/-/mcp-${release.version}.tgz`
    }
  })
  if (path === '/@tempad-dev%2fmcp')
    return {
      status: 200,
      metadata: {
        name: '@tempad-dev/mcp',
        'dist-tags': { latest: latest.version },
        versions: Object.fromEntries(
          releases.map((release) => [release.version, metadata(release)])
        )
      }
    }
  for (const release of releases) {
    const archivePath = `/@tempad-dev/mcp/-/mcp-${release.version}.tgz`
    if (path === archivePath) return { status: 200, archive: release.archive }
    if (
      path === `/@tempad-dev%2fmcp/${release.version}` ||
      (release === latest && path === '/@tempad-dev%2fmcp/latest')
    )
      return {
        status: 200,
        metadata: metadata(release)
      }
  }
  return { status: 404 }
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve)
  })
}

async function close(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

export async function assertReleasePortsFree() {
  const held = []
  try {
    for (const port of MCP_PORT_CANDIDATES) {
      const server = createSocketServer()
      try {
        await listen(server, port)
      } catch (error) {
        throw new Error(
          `Release discovery port ${port} is occupied; stop its owner explicitly before preparing or serving this fixture.`,
          { cause: error }
        )
      }
      held.push(server)
    }
  } finally {
    await Promise.all(held.map(close))
  }
}

async function immutable(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await immutable(path)
    else {
      assert.ok(entry.isFile(), 'Verified packages cannot contain links or special files.')
      await chmod(path, 0o400)
    }
  }
  await chmod(directory, 0o500)
}

async function unpack(files, directory) {
  for (const [path, bytes] of files) {
    const target = join(directory, path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
  }
}

async function prepare(requestedRoot) {
  await assertReleasePortsFree()
  // mkdir is intentionally exclusive: a previous fixture or runtime state is never reused.
  await mkdir(requestedRoot, { mode: 0o700 })
  const root = await realpath(requestedRoot)
  if (Buffer.byteLength(join(root, 'run/supervisor.sock')) >= 100)
    throw new Error('Use a short private root, for example /tmp/tp-native-<unique>.')
  const env = fixtureEnvironment(root)
  for (const directory of [...Object.values(env), join(root, 'archives'), join(root, 'packages')])
    await mkdir(directory, { mode: 0o700 })
  // Verifier imports create lock files and initialize logging; keep them outside native state.
  Object.assign(process.env, fixtureEnvironment(join(root, 'tooling')))
  const childEnv = {
    ...process.env,
    COREPACK_ENABLE_NETWORK: '0',
    PNPM_DISABLE_SELF_UPDATE_CHECK: 'true',
    npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:9',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_cache: join(root, 'npm-cache')
  }
  for (const key of Object.keys(childEnv))
    if (key === 'NODE_OPTIONS' || /^(?:CODEX_|CLAUDE|TEMPAD_MCP_DEV_CHECKOUT)/.test(key))
      delete childEnv[key]
  const sourceHash = runtimeSourceHash(checkout)
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  const [major, minor, patch] = pkg.version.split('.').map(Number)
  const registryReservation = createSocketServer((socket) => socket.destroy())
  await listen(registryReservation, 0)
  const registryUrl = `http://127.0.0.1:${registryReservation.address().port}`
  let verifier
  const stagingDirectories = []
  try {
    const deploy = join(root, 'deploy')
    await exec(
      'pnpm',
      [
        '--filter',
        '@tempad-dev/mcp',
        'deploy',
        '--prod',
        '--offline',
        '--ignore-scripts',
        '--frozen-lockfile',
        '--config.node-linker=hoisted',
        deploy
      ],
      { cwd: checkout, env: childEnv, maxBuffer: 8 * 1024 * 1024 }
    )
    const { build } = await import('tsdown')
    const { default: config } = await import('../tsdown.config.ts')
    const policy = JSON.parse(await readFile(join(source, 'runtime-policy.json'), 'utf8'))
    const releases = []
    for (const version of [pkg.version, `${major}.${minor}.${patch + 1}`]) {
      const staging = join(root, `build-${version}`)
      stagingDirectories.push(staging)
      await cp(deploy, staging, { recursive: true })
      const fixturePackage = {
        ...pkg,
        version,
        private: true,
        publishConfig: { registry: registryUrl }
      }
      await writeFile(join(staging, 'package.json'), JSON.stringify(fixturePackage))
      await build({
        ...config,
        config: false,
        cwd: source,
        outDir: join(staging, 'dist'),
        plugins: [
          ...config.plugins,
          {
            name: 'native-release-fixture',
            load(id) {
              if (id === join(source, 'package.json')) return JSON.stringify(fixturePackage)
            },
            transform(code, id) {
              if (id !== join(source, 'src/runtime-update/registry.ts')) return
              const declaration = "const REGISTRY = 'https://registry.npmjs.org'"
              assert.ok(code.includes(declaration), 'Review the changed release registry source.')
              return code.replace(declaration, `const REGISTRY = ${JSON.stringify(registryUrl)}`)
            }
          }
        ]
      })
      verifier ??= await import(pathToFileURL(join(staging, 'dist/runtime-verification.mjs')).href)
      const pack = async () => {
        const result = await exec(
          'npm',
          ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', root],
          { cwd: staging, env: childEnv, maxBuffer: 8 * 1024 * 1024 }
        )
        const [packed] = JSON.parse(result.stdout)
        const path = join(root, packed.filename)
        const bytes = await readFile(path)
        await rm(path)
        return { bytes, integrity: packed.integrity }
      }
      await rm(join(staging, verifier.MANIFEST_PATH), { force: true })
      const files = verifier.readArchive((await pack()).bytes)
      const probeDirectory = join(root, `probe-${version}`)
      await unpack(files, probeDirectory)
      const probe = await verifier.probeArtifact(join(probeDirectory, 'dist/managed-runtime.mjs'))
      assert.equal(probe.artifact.version, version)
      const preceding = releases.at(-1)
      const manifest = verifier.ManifestSchema.parse({
        ...policy,
        guidanceReview: {
          ...policy.guidanceReview,
          version,
          sourceHash,
          ...(preceding
            ? {
                decision: 'compatible',
                baseline: { version: preceding.version, integrity: preceding.integrity },
                rationale:
                  'Test-only successor built from the same source bytes and release logic as the initial fixture; only its package version differs.'
              }
            : {})
        },
        name: pkg.name,
        packageVersion: version,
        entry: 'dist/managed-runtime.mjs',
        node: pkg.engines.node,
        platforms: ['darwin', 'linux'],
        wireHash: probe.wireHash,
        presentationHash: probe.presentationHash,
        lockHash: verifier.sha256(await readFile(join(checkout, 'pnpm-lock.yaml'))),
        files: Object.fromEntries([...files].map(([path, bytes]) => [path, verifier.sha256(bytes)]))
      })
      if (preceding) verifier.validatePolicyBaseline(manifest, preceding.manifest)
      await writeFile(join(staging, verifier.MANIFEST_PATH), JSON.stringify(manifest))
      const { bytes, integrity } = await pack()
      const verified = verifier.verifyArchive(bytes, version, integrity)
      const archive = join(root, 'archives', `mcp-${version}.tgz`)
      const directory = join(root, 'packages', version)
      await writeFile(archive, bytes, { flag: 'wx', mode: 0o400 })
      await unpack(verified.files, directory)
      await immutable(directory)
      releases.push({ version, directory, archive, integrity, manifest })
      await rm(probeDirectory, { recursive: true })
    }
    assert.equal(
      runtimeSourceHash(checkout),
      sourceHash,
      'Sources changed during fixture preparation.'
    )
    await assertReleasePortsFree()
    await rm(deploy, { recursive: true })
    await chmod(join(root, 'archives'), 0o500)
    await chmod(join(root, 'packages'), 0o500)
    const [initial, candidate] = releases.map(({ manifest: _manifest, ...release }) => release)
    const fixture = validateFixture(
      {
        version: 1,
        kind: 'native-runtime-fixture',
        testOnly: true,
        checkout: await realpath(checkout),
        root,
        sourceHash,
        registryUrl,
        releasePorts: MCP_PORT_CANDIDATES,
        env,
        initial,
        candidate
      },
      root
    )
    await writeFile(join(root, 'registry-requests.jsonl'), '', { flag: 'wx', mode: 0o600 })
    await writeFile(join(root, descriptorName), JSON.stringify(fixture, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o400
    })
    console.log(JSON.stringify({ descriptor: join(root, descriptorName), ...fixture }))
  } finally {
    verifier?.endLogging()
    await close(registryReservation)
    for (const directory of stagingDirectories)
      await rm(directory, { recursive: true, force: true })
  }
}

async function serve(requestedRoot, holdCandidate) {
  const root = await realpath(requestedRoot)
  const stat = await lstat(root)
  assert.equal(stat.mode & 0o077, 0, 'Fixture root must remain private.')
  const fixture = validateFixture(
    JSON.parse(await readFile(join(root, descriptorName), 'utf8')),
    root
  )
  Object.assign(process.env, fixtureEnvironment(join(root, 'tooling')))
  const verifier = await import(
    pathToFileURL(join(fixture.initial.directory, 'dist/runtime-verification.mjs')).href
  )
  const archives = new Map()
  try {
    for (const release of [fixture.initial, fixture.candidate]) {
      const bytes = await readFile(release.archive)
      verifier.verifyArchive(bytes, release.version, release.integrity)
      archives.set(release.archive, bytes)
    }
  } finally {
    verifier.endLogging()
  }
  await assertReleasePortsFree()
  let candidateAvailable = !holdCandidate
  const revealCandidate = () => {
    if (candidateAvailable) return
    candidateAvailable = true
    console.log(
      JSON.stringify({ event: 'candidate-available', version: fixture.candidate.version })
    )
  }
  const server = createServer((req, res) => {
    const result = fixtureResponse(fixture, req.method, req.url, candidateAvailable)
    appendFileSync(
      join(root, 'registry-requests.jsonl'),
      JSON.stringify({
        at: new Date().toISOString(),
        method: req.method,
        path: req.url,
        status: result.status
      }) + '\n'
    )
    res.writeHead(result.status, {
      'content-type': result.metadata ? 'application/json' : 'application/octet-stream',
      'cache-control': 'no-store'
    })
    res.end(result.metadata ? JSON.stringify(result.metadata) : archives.get(result.archive))
  })
  await listen(server, Number(new URL(fixture.registryUrl).port))
  // SIGUSR1 is reserved for Node's debugger; this test-only signal exposes the
  // already-verified candidate without restarting the registry or installed host.
  if (holdCandidate) process.on('SIGUSR2', revealCandidate)
  server.once('close', () => process.off('SIGUSR2', revealCandidate))
  console.log(
    JSON.stringify({
      registryUrl: fixture.registryUrl,
      descriptor: join(root, descriptorName),
      pid: process.pid,
      candidateAvailable,
      ...(holdCandidate ? { revealSignal: 'SIGUSR2', heldVersion: fixture.candidate.version } : {})
    })
  )
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close()
      server.closeIdleConnections()
    })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      prepare: { type: 'boolean' },
      serve: { type: 'boolean' },
      'hold-candidate': { type: 'boolean' }
    }
  })
  if (
    !values.root ||
    !isAbsolute(values.root) ||
    !!values.prepare === !!values.serve ||
    (values['hold-candidate'] && !values.serve)
  )
    throw new Error(
      'Use --root <absolute-private-root> --prepare or --serve [--hold-candidate]. Test-only; never publish.'
    )
  if (process.platform === 'win32' || process.env.TEMPAD_MCP_DEV_CHECKOUT)
    throw new Error(
      'Native fixtures require a Unix release environment without TEMPAD_MCP_DEV_CHECKOUT.'
    )
  if (values.prepare) await prepare(values.root)
  else await serve(values.root, values['hold-candidate'])
}
