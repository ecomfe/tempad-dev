import assert from 'node:assert/strict'
import console from 'node:console'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { parseArgs } from 'node:util'
import ts from 'typescript'

import { runPackageManagerSync } from './package-manager.mjs'
import { deployRuntimeDependencies } from './runtime-dependencies.mjs'
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
if (process.env.TEMPAD_MCP_DEV_CHECKOUT)
  throw new Error('Prepare release artifacts in a release environment, not a checkout profile.')
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
  // symlinks escaping the npm tarball. No registry queries or lifecycle scripts run.
  deployRuntimeDependencies(repo, deploy, { offline: true })
  rmSync(join(deploy, MANIFEST_PATH), { force: true })
  const packed = JSON.parse(
    runPackageManagerSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      { cwd: deploy, encoding: 'utf8' }
    )
  )[0]
  const files = readArchive(readFileSync(join(root, packed.filename)))
  assert.ok(files.size < 150, 'The bundled runtime must contain fewer than 150 files.')
  assert.ok([...files.keys()].every((path) => !path.startsWith('node_modules/')))
  // onlyImport rejects external ESM imports during bundling. Also check static
  // CommonJS imports; ws deliberately probes these optional native accelerators.
  const optionalRequires = new Set(['bufferutil', 'utf-8-validate'])
  for (const [path, bytes] of files) {
    if (!path.endsWith('.mjs')) continue
    const source = ts.createSourceFile(
      path,
      bytes.toString('utf8'),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS
    )
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /^(?:__)?require$/.test(node.expression.text) &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const specifier = node.arguments[0].text
        assert.ok(
          isBuiltin(specifier) || optionalRequires.has(specifier),
          `Unexpected external CommonJS import in ${path}: ${specifier}`
        )
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const shippedPackage = JSON.parse(files.get('package.json').toString('utf8'))
  // Older managed runtimes require both fields, even for a self-contained bundle.
  assert.deepEqual(shippedPackage.dependencies, {})
  assert.deepEqual(shippedPackage.bundleDependencies, [])
  assert.equal(shippedPackage.bin, 'dist/cli.mjs')
  for (const name of ['cli', 'log-transport', 'thread-stream-worker', 'pino-worker', 'pino-file'])
    assert.ok(files.has(`dist/${name}.mjs`), `Missing runtime entry: ${name}`)
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
    platforms: ['darwin', 'linux', 'win32'],
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
    runPackageManagerSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      { cwd: deploy, encoding: 'utf8' }
    )
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
      files: readArchive(bytes).size,
      bytes: bytes.length,
      baselineVerified: !!values['verify-baseline']
    })
  )
} finally {
  verifier.endLogging()
  rmSync(root, { force: true, recursive: true })
}
