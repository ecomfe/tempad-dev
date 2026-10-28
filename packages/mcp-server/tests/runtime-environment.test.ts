import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

import { hostEnvironment, hubEnvironment, platformEnvironment } from '../src/process-environment'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => Object.defineProperty(process, 'platform', platform))

it.each(['canonical', 'uppercase'])('preserves Windows OS variables with %s names', (casing) => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const expected = {
    PATH: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    SystemDrive: 'C:',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramW6432: 'C:\\Program Files',
    PROCESSOR_ARCHITECTURE: 'AMD64',
    USERNAME: 'runner',
    APPDATA: 'C:\\Users\\runner\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\runner\\AppData\\Local',
    HOMEDRIVE: 'C:',
    HOMEPATH: '\\Users\\runner'
  }
  const env = {
    ...Object.fromEntries(
      Object.entries(expected).map(([key, value]) => [
        casing === 'uppercase' ? key.toUpperCase() : key,
        value
      ])
    ),
    CODEX_THREAD_ID: 'parent-task',
    CLAUDE_CODE_SESSION_ID: 'parent-session',
    OPENAI_API_KEY: 'secret',
    NODE_OPTIONS: '--require injected.js',
    NODE_EXTRA_CA_CERTS: 'C:\\Company\\ca.pem',
    PSModulePath: 'C:\\PowerShell7\\Modules',
    TEMPAD_MCP_UNKNOWN: 'not-config',
    tempad_mcp_tool_timeout: '1000'
  }
  expect(platformEnvironment(env)).toEqual(expected)
  expect(hubEnvironment(env)).toEqual({
    ...expected,
    TEMPAD_MCP_TOOL_TIMEOUT: '1000',
    NODE_EXTRA_CA_CERTS: 'C:\\Company\\ca.pem'
  })
})

it('replaces all Windows home and temporary aliases with the selected host context', () => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const context = {
    version: 1 as const,
    home: 'D:\\Host B',
    tempDir: 'D:\\Host B\\Temp',
    codexHome: 'D:\\Host B\\.codex',
    codexSqliteHome: 'D:\\Host B\\sqlite'
  }
  expect(
    hostEnvironment(context, {
      home: 'C:\\Previous',
      UserProfile: 'C:\\Previous',
      HomeDrive: 'C:',
      HomePath: '\\Previous',
      TmpDir: 'C:\\Previous\\Temp',
      Temp: 'C:\\Previous\\Temp',
      Tmp: 'C:\\Previous\\Temp',
      PROGRAMFILES: 'C:\\Program Files',
      CODEX_THREAD_ID: 'previous-task'
    })
  ).toEqual({
    HOME: context.home,
    USERPROFILE: context.home,
    HOMEDRIVE: 'D:',
    HOMEPATH: '\\Host B',
    TMPDIR: context.tempDir,
    TEMP: context.tempDir,
    TMP: context.tempDir,
    ProgramFiles: 'C:\\Program Files',
    CODEX_HOME: context.codexHome,
    CODEX_SQLITE_HOME: context.codexSqliteHome
  })
})

it('retains exact-key filtering on Unix', () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  expect(
    hubEnvironment({
      PATH: '/bin',
      path: '/wrong',
      HOME: '/home',
      home: '/wrong',
      ProgramFiles: '/not-a-unix-platform-variable',
      tempad_mcp_tool_timeout: 'wrong',
      TEMPAD_MCP_TOOL_TIMEOUT: '1000'
    })
  ).toEqual({ PATH: '/bin', HOME: '/home', TEMPAD_MCP_TOOL_TIMEOUT: '1000' })
})

it('preserves an explicit TLS CA through launcher and installer environments without weakening verification', async () => {
  // Public test-only key/certificate; no external trust store is modified.
  const certificate = new URL('./fixtures/runtime-ca.pem', import.meta.url)
  const server = createServer(
    {
      cert: readFileSync(certificate),
      key: readFileSync(new URL('./fixtures/runtime-ca-key.pem', import.meta.url))
    },
    (_request, response) => {
      response.setHeader('connection', 'close')
      response.end('verified TLS')
    }
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `https://127.0.0.1:${(server.address() as { port: number }).port}`
  const worker = `
    for (const key of ['NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'CODEX_THREAD_ID', 'NPM_TOKEN'])
      if (process.env[key]) throw new Error('Inherited forbidden variable: ' + key);
    process.stdout.write(await (await fetch(${JSON.stringify(url)})).text());
  `
  const launcher = `
    import { execFile } from 'node:child_process';
    import { promisify } from 'node:util';
    import { hubEnvironment } from ${JSON.stringify(new URL('../src/process-environment.ts', import.meta.url).href)};
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(worker)}], { env: hubEnvironment(process.env) });
    process.stdout.write(stdout);
  `
  const env = hubEnvironment({
    ...process.env,
    NODE_EXTRA_CA_CERTS: undefined,
    NODE_OPTIONS: '--require=must-not-run',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    CODEX_THREAD_ID: 'unrelated',
    NPM_TOKEN: 'must-not-inherit'
  })
  const run = (env: NodeJS.ProcessEnv) =>
    promisify(execFile)(process.execPath, ['--input-type=module', '--eval', launcher], {
      env,
      timeout: 10000
    })
  try {
    await expect(run(env)).rejects.toThrow('fetch failed')
    await expect(
      run({ ...env, NODE_EXTRA_CA_CERTS: fileURLToPath(certificate) })
    ).resolves.toHaveProperty('stdout', 'verified TLS')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
