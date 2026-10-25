import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { parseArgs } from 'node:util'

import { runtimeSourceHash } from './runtime-source-hash.mjs'

const repo = fileURLToPath(new URL('../../..', import.meta.url))
const source = join(repo, 'packages/mcp-server')
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    'source-hash': { type: 'boolean' },
    'verify-baseline': { type: 'boolean' }
  }
})
const sourceHash = runtimeSourceHash(repo)
if (values['source-hash']) {
  console.log(sourceHash)
  process.exit(0)
}
if (process.env.TEMPAD_MCP_DEV_CHECKOUT || process.platform === 'win32')
  throw new Error('Prepare release artifacts in a release environment on macOS or Linux.')
if (!values.output || !isAbsolute(values.output))
  throw new Error('Use --output <absolute-new.tgz> [--verify-baseline].')

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-release-')))
for (const [key, path] of Object.entries({
  TEMPAD_MCP_RUNTIME_DIR: 'run',
  TEMPAD_MCP_STATE_DIR: 'state',
  TEMPAD_MCP_ASSET_DIR: 'assets',
  TEMPAD_MCP_LOG_DIR: 'logs'
}))
  process.env[key] = join(root, path)
const verifier = await import('../dist/runtime-verification.mjs')
const {
  PolicySchema,
  ManifestSchema,
  MANIFEST_PATH,
  readArchive,
  sha256,
  verifyArchive,
  probeArtifact,
  validatePolicyBaseline,
  resolveRelease,
  downloadRelease
} = verifier
try {
  const policy = PolicySchema.parse(
    JSON.parse(readFileSync(join(source, 'runtime-policy.json'), 'utf8'))
  )
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  assert.deepEqual(policy.controlProtocols, [...verifier.CONTROL_VERSIONS])
  assert.deepEqual(policy.extension.protocols, [
    ...verifier.TEMPAD_MCP_BRIDGE_SUPPORTED_PROTOCOL_VERSIONS
  ])
  if (
    policy.guidanceReview.sourceHash !== sourceHash ||
    policy.guidanceReview.version !== pkg.version
  )
    throw new Error('Revalidate the release guidance review and source hash before packaging.')
  const deploy = join(root, 'deploy')
  // A hoisted, offline deploy from the frozen workspace lock avoids pnpm store
  // symlinks escaping the npm tarball. No installation or lifecycle scripts run.
  execFileSync(
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
    { cwd: repo, stdio: 'inherit' }
  )
  rmSync(join(deploy, MANIFEST_PATH), { force: true })
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      cwd: deploy,
      encoding: 'utf8'
    })
  )[0]
  const files = readArchive(readFileSync(join(root, packed.filename)))
  const unpacked = join(root, 'unpacked')
  for (const [path, bytes] of files) {
    const target = join(unpacked, path)
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 })
  }
  const probe = await probeArtifact(join(unpacked, 'dist/managed-runtime.mjs'))
  if (probe.artifact.version !== pkg.version)
    throw new Error('Built runtime version differs from the release package.')
  const manifest = ManifestSchema.parse({
    ...policy,
    name: pkg.name,
    packageVersion: pkg.version,
    entry: 'dist/managed-runtime.mjs',
    node: pkg.engines.node,
    platforms: ['darwin', 'linux'],
    wireHash: probe.wireHash,
    presentationHash: probe.presentationHash,
    lockHash: sha256(readFileSync(join(repo, 'pnpm-lock.yaml'))),
    files: Object.fromEntries([...files].map(([path, bytes]) => [path, sha256(bytes)]))
  })
  if (values['verify-baseline']) {
    const latest = await resolveRelease('latest')
    if (latest.version !== policy.guidanceReview.baseline.version)
      throw new Error('Review guidance against the current stable release before publishing.')
    const baseline = await resolveRelease(policy.guidanceReview.baseline.version)
    if (baseline.integrity !== policy.guidanceReview.baseline.integrity)
      throw new Error('Reviewed npm baseline integrity changed.')
    const archive = await downloadRelease(baseline)
    verifier.verifyIntegrity(archive, baseline.integrity)
    const baselineFiles = readArchive(archive)
    const historical = baselineFiles.get(MANIFEST_PATH)
    validatePolicyBaseline(
      manifest,
      historical ? verifyArchive(archive, baseline.version, baseline.integrity).manifest : undefined
    )
  }
  writeFileSync(join(deploy, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + '\n')
  rmSync(join(root, packed.filename))
  const final = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      cwd: deploy,
      encoding: 'utf8'
    })
  )[0]
  const bytes = readFileSync(join(root, final.filename))
  verifyArchive(bytes, pkg.version, final.integrity)
  writeFileSync(values.output, bytes, { flag: 'wx', mode: 0o600 })
  writeFileSync(
    `${values.output}.json`,
    JSON.stringify({ version: pkg.version, integrity: final.integrity, manifest }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 }
  )
  console.log(
    JSON.stringify({
      artifact: values.output,
      version: pkg.version,
      integrity: final.integrity,
      files: files.size,
      bytes: bytes.length,
      baselineVerified: !!values['verify-baseline']
    })
  )
} finally {
  verifier.endLogging()
  rmSync(root, { force: true, recursive: true })
}
