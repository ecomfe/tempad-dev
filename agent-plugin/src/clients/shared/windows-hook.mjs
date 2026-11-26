import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'

// Check the descriptor and exchange bytes on the same handle. Anonymous impersonation also
// prevents a pipe server from acting as the hook's caller while its identity is being checked.
const exchange = String.raw`
$ErrorActionPreference = 'Stop'
$PSModuleAutoloadingPreference = 'None'
$utf8 = [Text.UTF8Encoding]::new($false)
$inputReader = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$outputWriter = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$outputWriter.AutoFlush = $true
$rights = [IO.Pipes.PipeAccessRights]'ReadData,WriteData,ReadPermissions'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($user, 'S-1-5-18', 'S-1-5-32-544')
function Send-HookFrame([string]$frame) {
  $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $env:TEMPAD_HOOK_PIPE, $rights,
    [IO.Pipes.PipeOptions]::Asynchronous, [Security.Principal.TokenImpersonationLevel]::Anonymous,
    [IO.HandleInheritability]::None)
  try {
    try { $pipe.Connect(100) } catch [TimeoutException] { return 'unavailable' }
    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($pipe.GetAccessControl().GetSecurityDescriptorBinaryForm(), 0)
    if ($allowed -notcontains $descriptor.Owner.Value -or $null -eq $descriptor.DiscretionaryAcl) { return }
    $ownAccess = $false
    foreach ($ace in $descriptor.DiscretionaryAcl) {
      if ($ace.AceType -eq 'AccessDenied') { continue }
      if ($ace.AceType -ne 'AccessAllowed' -or $allowed -notcontains $ace.SecurityIdentifier.Value) { return }
      if ($ace.SecurityIdentifier.Value -eq $user) { $ownAccess = $true }
    }
    if (!$ownAccess) { return }
    $bytes = $utf8.GetBytes($frame + [char]10)
    if (!$pipe.WriteAsync($bytes, 0, $bytes.Length).Wait(200)) { return }
    $buffer = [byte[]]::new(8192)
    $reply = [IO.MemoryStream]::new()
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($reply.Length -lt 1000000) {
      $read = $pipe.ReadAsync($buffer, 0, $buffer.Length)
      if (!$read.Wait([Math]::Max(0, 200 - [int]$clock.ElapsedMilliseconds)) -or !$read.Result) { return }
      $newline = [Array]::IndexOf($buffer, [byte]10, 0, $read.Result)
      if ($newline -ge 0) {
        $reply.Write($buffer, 0, $newline)
        if ($reply.Length -le 1000000) { return $utf8.GetString($reply.ToArray()) }
        return
      }
      $reply.Write($buffer, 0, $read.Result)
    }
  } finally { $pipe.Dispose() }
}
while ($null -ne ($frame = $inputReader.ReadLine())) {
  try { $response = Send-HookFrame $frame } catch { $response = $null }
  $outputWriter.WriteLine([string]$response)
}
`

export function openWindowsHook(path) {
  const prefix = '\\\\.\\pipe\\'
  const systemRoot = process.env.SystemRoot
  if (!systemRoot || !isAbsolute(systemRoot) || !path.startsWith(prefix))
    throw new Error('A local Windows pipe and SystemRoot are required.')
  const child = spawn(
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(exchange, 'utf16le').toString('base64')
    ],
    {
      env: { ...process.env, TEMPAD_HOOK_PIPE: path.slice(prefix.length) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    }
  )
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]()
  child.on('error', () => child.stdout.destroy())
  child.stdin.on('error', () => {})
  return {
    async request(frame) {
      child.stdin.write(frame)
      const { value } = await lines.next()
      if (value === 'unavailable')
        throw Object.assign(new Error('No available Hub pipe.'), { code: 'ENOENT' })
      if (!value) throw new Error('No verified Windows hook reply.')
      return JSON.parse(value)
    },
    close: () => child.kill()
  }
}
