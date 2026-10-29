// Opt-in process-fixture diagnostics. Never loaded by a published runtime.
import { Buffer } from 'node:buffer'
import childProcess from 'node:child_process'
import { mkdirSync, writeSync } from 'node:fs'
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
const evidence = process.env.TEMPAD_RUNTIME_EVIDENCE_DIR
if (evidence) mkdirSync(evidence, { recursive: true })

function traceSecurityHelper(args) {
  const [commandArgs, options] = args
  const index = Array.isArray(commandArgs) ? commandArgs.indexOf('-EncodedCommand') : -1
  if (!evidence || index < 0 || !options?.env?.TEMPAD_RUNTIME_ACL_REQUEST) return args
  let script = Buffer.from(commandArgs[index + 1], 'base64').toString('utf16le')
  const phases = [
    ["$ErrorActionPreference = 'Stop'", 'script-started'],
    ['[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)', 'encoding-set'],
    [
      'Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop',
      'utility-imported'
    ],
    [
      'Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop',
      'security-imported'
    ],
    ['$request = $env:TEMPAD_RUNTIME_ACL_REQUEST | ConvertFrom-Json', 'request-parsed'],
    ['$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User', 'identity-read'],
    ['[void][IO.Directory]::CreateDirectory($request.path, $security)', 'directory-created'],
    ['$acl = Get-Acl -LiteralPath $request.path', 'acl-read']
  ]
  for (const [statement, phase] of phases)
    script = script.replace(
      statement,
      () =>
        `${statement}\ntry { [IO.File]::AppendAllText($env:TEMPAD_RUNTIME_ACL_TRACE, ([DateTime]::UtcNow.ToString('o') + ' ${phase}' + [Environment]::NewLine)) } catch {}`
    )
  const traced = [...commandArgs]
  traced[index + 1] = Buffer.from(script, 'utf16le').toString('base64')
  return [
    traced,
    {
      ...options,
      env: { ...options.env, TEMPAD_RUNTIME_ACL_TRACE: join(evidence, `acl-${process.pid}.log`) }
    }
  ]
}

const execute = childProcess.execFileSync
childProcess.execFileSync = function (file, ...args) {
  const command = basename(file)
  trace({ phase: 'helper-start', command })
  try {
    const result = execute.call(this, file, ...traceSecurityHelper(args))
    trace({ phase: 'helper-end', command })
    return result
  } catch (error) {
    trace({ phase: 'helper-error', command, code: error.code })
    throw error
  }
}
syncBuiltinESMExports()
