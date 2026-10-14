import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
if (!process.argv[2]) throw new Error('Pass the official TypeScript 6.0.3 bin/tsc path.')
const compiler = realpathSync(resolve(process.argv[2]))
const compilerPackage = JSON.parse(readFileSync(join(dirname(compiler), '../package.json'), 'utf8'))
if (compilerPackage.name !== 'typescript' || compilerPackage.version !== '6.0.3')
  throw new Error('Expected official typescript@6.0.3, not a compiler alias or fork.')
const directory = mkdtempSync(join(tmpdir(), 'tempad-declarations-'))

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} exited with ${result.status ?? result.signal}.`)
}

try {
  for (const name of ['shared', 'plugins']) {
    const source = join(root, 'packages', name)
    const target = join(directory, 'node_modules', '@tempad-dev', name)
    mkdirSync(target, { recursive: true })
    copyFileSync(join(source, 'package.json'), join(target, 'package.json'))
    // Exercise the real declaration generator without changing workspace dist.
    run('pnpm', ['exec', 'tsdown', '--out-dir', join(target, 'dist')], source)
  }
  symlinkSync(
    realpathSync(join(root, 'packages/shared/node_modules/zod')),
    join(directory, 'node_modules/zod'),
    'junction'
  )
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  writeFileSync(
    join(directory, 'consumer.ts'),
    `import { GetCodeParametersSchema, type GetCodeParametersInput, type TempadMcpErrorCode } from '@tempad-dev/shared'
import { definePlugin, h, type DevComponent, type Plugin } from '@tempad-dev/plugins'

const input: GetCodeParametersInput = { nodeIds: ['1:2'], resolveTokens: true }
const output = GetCodeParametersSchema.parse(input)
const resolveTokens: boolean | undefined = output.resolveTokens
const error: TempadMcpErrorCode = 'REQUEST_ID_CONFLICT'
// @ts-expect-error Public schema inputs must not silently become any.
const invalidInput: GetCodeParametersInput = { resolveTokens: 'true' }
// @ts-expect-error Error codes remain a closed union.
const invalidError: TempadMcpErrorCode = 'UNKNOWN_CODE'

const component: DevComponent<{ label: string }> = h('Button', { label: 'Save' })
const label: string = component.props.label
const plugin: Plugin = definePlugin({
  name: 'Consumer',
  code: { css: { transform({ code }) { return code.trim() } }, js: false }
})
// @ts-expect-error Public plugin metadata must not silently become any.
definePlugin({ name: 123, code: {} })
`
  )
  // No workspace source condition or skipLibCheck: consume only packaged declarations.
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: []
      },
      files: ['consumer.ts']
    })
  )
  run(process.execPath, [compiler, '-p', directory], directory)
  console.log('Packaged shared/plugins declarations passed official TypeScript consumption.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
