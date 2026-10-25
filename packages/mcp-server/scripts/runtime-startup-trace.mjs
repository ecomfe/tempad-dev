// Opt-in process-fixture diagnostics. Never loaded by a published runtime.
import { Buffer } from 'node:buffer'
import childProcess from 'node:child_process'
import { writeSync, appendFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

const started = performance.now()
function trace(event) {
  writeSync(
    2,
    `Runtime startup ${JSON.stringify({ pid: process.pid, ms: Math.round(performance.now() - started), ...event })}\n`
  )
}
trace({ phase: 'entry' })
const execute = childProcess.execFileSync
childProcess.execFileSync = function (file, ...args) {
  const command = basename(file)
  trace({ phase: 'helper-start', command })
  const rootIndex = process.argv.indexOf('--root')
  const root = rootIndex < 0 ? undefined : process.argv[rootIndex + 1]
  const encodedIndex = Array.isArray(args[0]) ? args[0].indexOf('-EncodedCommand') : -1
  if (command.toLowerCase() === 'powershell.exe' && root && encodedIndex >= 0) {
    const path = join(root, `startup-${process.pid}.log`)
    appendFileSync(path, 'Node started ACL helper\n')
    const marker = (stage) =>
      `[IO.File]::AppendAllText($env:TEMPAD_RUNTIME_TRACE_PATH, "${stage} $([DateTime]::UtcNow.ToString('o'))\n")\n`
    let source = Buffer.from(args[0][encodedIndex + 1], 'base64').toString('utf16le')
    source = source.replace(
      '$request = $env:TEMPAD_RUNTIME_ACL_REQUEST | ConvertFrom-Json',
      `${marker('utility-import-start')}Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop\n${marker('utility-imported')}$request = $env:TEMPAD_RUNTIME_ACL_REQUEST | ConvertFrom-Json`
    )
    for (const [boundary, stage] of [
      ['[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)', 'encoding-set'],
      ['$request = $env:TEMPAD_RUNTIME_ACL_REQUEST | ConvertFrom-Json', 'json-parsed'],
      ['$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User', 'user-resolved'],
      ['$acl = Get-Acl -LiteralPath $request.path', 'acl-read']
    ])
      source = source.replace(boundary, `${boundary}\n${marker(stage)}`)
    source = marker('script-started') + source + marker('script-finished')
    const commandArgs = [...args[0]]
    commandArgs[encodedIndex + 1] = Buffer.from(source, 'utf16le').toString('base64')
    args = [
      commandArgs,
      {
        ...args[1],
        env: {
          ...(args[1]?.env ?? process.env),
          // Diagnostic control: only built-in Windows PowerShell modules are needed.
          PSModulePath: join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'),
          TEMPAD_RUNTIME_TRACE_PATH: path
        }
      }
    ]
  }
  try {
    const result = execute.call(this, file, ...args)
    trace({ phase: 'helper-end', command })
    return result
  } catch (error) {
    trace({ phase: 'helper-error', command, code: error.code })
    throw error
  }
}
syncBuiltinESMExports()
