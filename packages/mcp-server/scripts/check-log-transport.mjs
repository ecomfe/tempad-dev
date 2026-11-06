import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import console from 'node:console'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { stripVTControlCharacters, TextDecoder } from 'node:util'

// Also accepts an unpacked/installed package to check the shipped worker and dependencies.
const packageDir = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
const dist = join(packageDir, 'dist')
const limit = 10 * 1024 * 1024
const sources = await readdir(dist, { recursive: true })
const owners = []
for (const name of sources) {
  if (!name.endsWith('.mjs')) continue
  const source = await readFile(join(dist, name), 'utf8')
  if (/new URL\(["']\.\/log-transport\.mjs["'], import\.meta\.url\)/.test(source)) {
    owners.push(join(dist, name))
  }
}
assert.equal(owners.length, 1, 'Expected one bundled logger owning the relative transport URL')
const target = join(dirname(owners[0]), 'log-transport.mjs')
assert.ok((await stat(target)).isFile(), 'Bundled logger must resolve its shipped worker')
const ownerSource = await readFile(owners[0], 'utf8')
const logExport = ownerSource.match(/\blog as ([\w$]+)/)?.[1]
const endExport = ownerSource.match(/\bendLogging as ([\w$]+)/)?.[1]
assert.ok(logExport && endExport, 'Expected the shipped logger and shutdown exports')

const childSource = `
import { once } from 'node:events'
const [owner, mode] = process.argv.slice(1)
const shipped = await import(owner)
const log = shipped[${JSON.stringify(logExport)}]
const streamKey = Object.getOwnPropertySymbols(log).find(key => key.description === 'pino.stream')
const transport = log[streamKey]
if (mode === 'startup-exit') {
  log.info('final-' + mode)
  process.exit(0)
}
if (!transport.ready) await once(transport, 'ready')
if (mode === 'rollover') {
  for (let i = 0; i < 12; i++) log.info('record-' + i + ':' + 'x'.repeat(1024 * 1024))
}
if (mode.startsWith('oversized')) {
  log.info('oversized-start:' + '中文🐈'.repeat(2 * 1024 * 1024))
} else {
  log.info({ detail: '中文 🐈' }, 'final-' + mode)
}
if (mode === 'immediate' || mode === 'oversized-immediate') process.exit(0)
shipped[${JSON.stringify(endExport)}]()
`

const directory = await mkdtemp(join(tmpdir(), 'tempad-log-package-'))
const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: directory,
  TMP: directory,
  TMPDIR: directory,
  TEMPAD_MCP_RUNTIME_DIR: join(directory, 'run'),
  TEMPAD_MCP_STATE_DIR: join(directory, 'state'),
  TEMPAD_MCP_ASSET_DIR: join(directory, 'assets'),
  TEMPAD_MCP_LOG_DIR: directory,
  FORCE_COLOR: '1'
}

async function check(mode) {
  const logDirectory = join(directory, mode)
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', childSource, pathToFileURL(owners[0]).href, mode],
      {
        cwd: directory,
        env: { ...env, TEMPAD_MCP_LOG_DIR: logDirectory },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (value) => {
      stdout += value
    })
    child.stderr.setEncoding('utf8').on('data', (value) => {
      stderr += value
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code !== 0 || stdout || stderr) {
        reject(new Error(`${mode}: exit=${code}, signal=${signal}\n${stdout}${stderr}`))
      } else resolve()
    })
  })
  const files = await readdir(logDirectory)
  assert.equal(files.length, 1, 'Expected one process-owned log file')
  const bytes = await readFile(join(logDirectory, files[0]))
  assert.ok(bytes.length <= limit, `${mode}: file exceeds 10 MiB`)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  assert.equal(text, stripVTControlCharacters(text), `${mode}: file contains terminal escapes`)
  if (mode.startsWith('oversized')) {
    assert.ok(bytes.length > limit - 4)
    assert.match(text, /oversized-start:中文🐈/)
    assert.match(text, /Oversized log entry truncated\.\n$/)
  } else {
    assert.match(text, new RegExp(`INFO.*\\[tempad-dev/mcp\\] final-${mode}`))
    if (mode !== 'startup-exit') assert.match(text, /detail: "中文 🐈"/)
  }
  if (mode === 'rollover') {
    assert.match(text, /Log rolled over at 10 MiB/)
    assert.doesNotMatch(text, /record-0:/)
  }
  console.log(`logging ${mode}: passed (${bytes.length} bytes)`)
}

try {
  // Independent writers exercise per-process isolation and both ordinary exit paths.
  const writers = await Promise.allSettled([check('normal'), check('immediate')])
  for (const writer of writers) {
    if (writer.status === 'rejected') throw writer.reason
  }
  await check('startup-exit')
  await check('rollover')
  await check('oversized')
  await check('oversized-immediate')
} finally {
  await rm(directory, { recursive: true, force: true })
}
