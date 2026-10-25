import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const PIPE_PREFIX = '\\\\.\\pipe\\'
const checkedPermissions = new Map<string, string>()

/** Runtime overrides must isolate pipes as well as files, including on one Windows account. */
export function runtimeEndpoint(
  directory: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
  user = userInfo().username
) {
  if (platform !== 'win32') return join(directory, name)
  const identity = createHash('sha256')
    .update(user)
    .update('\0')
    .update(directory.replaceAll('/', '\\').toLowerCase())
    .update('\0')
    .update(name)
    .digest('hex')
    .slice(0, 32)
  return `${PIPE_PREFIX}tempad-runtime-${identity}`
}

export function isPipe(path: string) {
  return path.startsWith(PIPE_PREFIX)
}

function canonical(path: string) {
  const actual = realpathSync(path)
  return process.platform === 'win32'
    ? actual.toLowerCase() === resolve(path).toLowerCase()
    : actual === path
}

/** Check real Windows ACLs; chmod and stat.mode do not establish Windows privacy. */
function inspectPath(path: string, kind: 'file' | 'directory') {
  if (!isAbsolute(path)) throw new Error('Runtime path must be absolute.')
  const stat = lstatSync(path, { bigint: true })
  if (
    stat.isSymbolicLink() ||
    !(kind === 'file' ? stat.isFile() : stat.isDirectory()) ||
    !canonical(path) ||
    (process.platform !== 'win32' && (stat.uid !== BigInt(process.getuid!()) || stat.mode & 0o077n))
  )
    throw new Error(`Refusing untrusted runtime ${kind}: ${path}`)
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.ctimeNs}`
}

function rememberPermissions(path: string, identity: string) {
  if (checkedPermissions.size >= 1024) checkedPermissions.clear()
  checkedPermissions.set(path, identity)
}

export function assertPrivatePath(path: string, kind: 'file' | 'directory') {
  const identity = inspectPath(path, kind)
  if (process.platform !== 'win32' || checkedPermissions.get(path) === identity) return
  windowsSecurity('inspect', path, kind)
  if (inspectPath(path, kind) !== identity)
    throw new Error(`Runtime ${kind} changed during its permission check: ${path}`)
  // Windows ChangeTime includes security descriptor changes. Content replacement, ACL edits
  // and inode reuse all invalidate this bounded cache; unchanged reads need no helper process.
  rememberPermissions(path, identity)
}

export function ensurePrivateDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error('Runtime directory must be absolute.')
  if (process.platform !== 'win32') {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    assertPrivatePath(path, 'directory')
    return
  }
  try {
    assertPrivatePath(path, 'directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    windowsSecurity('ensure', path, 'directory')
    rememberPermissions(path, inspectPath(path, 'directory'))
  }
}

export function createPrivateTempDirectory(prefix: string) {
  // macOS's per-user temp path leaves too little room for Unix socket names.
  const directory = process.platform === 'win32' ? tmpdir() : '/tmp'
  const path = join(realpathSync(directory), `${prefix}${randomUUID()}`)
  ensurePrivateDirectory(path)
  return path
}

export function cleanupEndpoint(path: string) {
  if (!isPipe(path)) rmSync(path, { force: true })
}

export function assertPrivateEndpoint(path: string) {
  if (!isPipe(path)) throw new Error('Expected a Windows runtime pipe.')
  windowsSecurity('inspect', path, 'pipe')
}

export function protectPipe(path: string) {
  if (!isPipe(path)) throw new Error('Expected a Windows runtime pipe.')
  windowsSecurity('protect', path, 'pipe')
}

export function windowsPowerShellEnvironment(env: NodeJS.ProcessEnv = process.env) {
  // PowerShell 7's module paths can load incompatible modules in Windows PowerShell 5.
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== 'psmodulepath')
  )
}

// Built-in Windows PowerShell supplies the platform ACL API without an npm/native dependency.
// JSON stays in a child-only environment value, never executable source or shell arguments.
// Helper input is independent of host stdio and the Windows console's input code page.
function windowsSecurity(action: 'ensure' | 'inspect' | 'protect', path: string, kind: string) {
  const systemRoot = process.env.SystemRoot
  if (!systemRoot || !isAbsolute(systemRoot))
    throw new Error('Windows SystemRoot is required to verify private runtime storage.')
  try {
    execFileSync(
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(SECURITY_SCRIPT, 'utf16le').toString('base64')
      ],
      {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: {
          ...windowsPowerShellEnvironment(),
          TEMPAD_RUNTIME_ACL_REQUEST: JSON.stringify({ action, path, kind })
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
  } catch (cause) {
    const error = cause as { stdout?: string; stderr?: string }
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    let code: number | string | undefined
    let reportedFailure = false
    try {
      const report = JSON.parse(error.stderr ?? '{}')
      code = report.code
      reportedFailure = typeof report.message === 'string'
    } catch {
      // Startup and policy failures need not be JSON; they still fail closed.
    }
    const failure = new Error(
      `Refusing untrusted Windows runtime ${kind}: ${path}${detail ? ` (${detail})` : ''}`,
      {
        cause
      }
    ) as NodeJS.ErrnoException
    if (code === 2 || code === 3) failure.code = 'ENOENT'
    if (code === 231) failure.code = 'EBUSY'
    if (code === 'EPIPEUNPROTECTED') failure.code = code
    if (!failure.code && kind === 'pipe' && reportedFailure) failure.code = 'EPIPEUNTRUSTED'
    throw failure
  }
}

const SECURITY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# Module autoload can stall with a filtered host environment. Use the trusted
# built-in modules directly, without scanning host/user module locations.
Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
$PSModuleAutoloadingPreference = 'None'
$failureCode = $null
try {
  $request = $env:TEMPAD_RUNTIME_ACL_REQUEST | ConvertFrom-Json
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
  if ($request.kind -eq 'pipe') {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class TempadPipeSecurity {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern uint GetSecurityInfo(SafeFileHandle handle, uint type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern uint SetSecurityInfo(SafeFileHandle handle, uint type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string value, uint revision, out IntPtr descriptor, out uint length);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
  [DllImport("advapi32.dll")]
  static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);
  public static byte[] Inspect(string path, string sddl) {
    // PowerShell converts a null string argument to an empty string.
    bool protect = !String.IsNullOrEmpty(sddl);
    SafeFileHandle opened = CreateFile(path, 0x20000u | (protect ? 0x40000u : 0u), 7, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    int openError = Marshal.GetLastWin32Error();
    using (SafeFileHandle handle = opened) {
      if (handle.IsInvalid) throw new Win32Exception(openError, "CreateFile failed for the runtime pipe.");
      if (protect) {
        IntPtr replacement; uint length;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out replacement, out length)) throw new Win32Exception(Marshal.GetLastWin32Error(), "ConvertStringSecurityDescriptorToSecurityDescriptor failed.");
        try {
          bool present, defaulted; IntPtr acl;
          if (!GetSecurityDescriptorDacl(replacement, out present, out acl, out defaulted)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetSecurityDescriptorDacl failed.");
          if (!present || acl == IntPtr.Zero) throw new InvalidOperationException("The replacement pipe descriptor has no discretionary ACL.");
          uint changed = SetSecurityInfo(handle, 6, 4u | 0x80000000u, IntPtr.Zero, IntPtr.Zero, acl, IntPtr.Zero);
          if (changed != 0) throw new Win32Exception((int)changed, "SetSecurityInfo failed for the runtime pipe.");
        } finally { LocalFree(replacement); }
      }
      IntPtr owner, group, dacl, sacl, descriptor;
      uint result = GetSecurityInfo(handle, 6, 5, out owner, out group, out dacl, out sacl, out descriptor);
      if (result != 0) throw new Win32Exception((int)result, "GetSecurityInfo failed for the runtime pipe.");
      try {
        byte[] bytes = new byte[GetSecurityDescriptorLength(descriptor)];
        Marshal.Copy(descriptor, bytes, 0, bytes.Length);
        return bytes;
      } finally { LocalFree(descriptor); }
    }
  }
}
'@
    $sddl = $null
    if ($request.action -eq 'protect') {
      $sddl = 'D:P(D;;GA;;;NU)(A;;GA;;;' + $user.Value + ')(A;;GA;;;SY)(A;;GA;;;BA)'
    }
    $bytes = [TempadPipeSecurity]::Inspect($request.path, $sddl)
    $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($bytes, 0)
  } else {
    if ($request.action -eq 'ensure' -and ![IO.Directory]::Exists($request.path)) {
      $security = New-Object System.Security.AccessControl.DirectorySecurity
      $security.SetOwner($user)
      $security.SetAccessRuleProtection($true, $false)
      foreach ($sid in $allowed) {
        $principal = New-Object System.Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $security.AddAccessRule($rule)
      }
      [void][IO.Directory]::CreateDirectory($request.path, $security)
    }
    $acl = Get-Acl -LiteralPath $request.path
    $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($acl.Sddl)
  }
  if ($allowed -notcontains $descriptor.Owner.Value -or $null -eq $descriptor.DiscretionaryAcl) {
    throw 'Unexpected owner or absent discretionary ACL.'
  }
  $ownAccess = $false
  $foreignAccess = $false
  $pendingProtection = $request.kind -eq 'pipe' -and $request.action -eq 'inspect' -and $descriptor.Owner.Value -eq $user.Value
  foreach ($ace in $descriptor.DiscretionaryAcl) {
    if ($ace.AceType -eq 'AccessAllowed') {
      if ($allowed -notcontains $ace.SecurityIdentifier.Value) {
        $foreignAccess = $true
        # Windows' initial pipe descriptor grants Everyone/Anonymous read. Only that
        # same-owner startup state is retryable; it must still become private.
        $defaultReader = @('S-1-1-0', 'S-1-5-7') -contains $ace.SecurityIdentifier.Value
        $readOnly = ($ace.AccessMask -band 0x7fedff76) -eq 0
        $pendingProtection = $pendingProtection -and $defaultReader -and $readOnly
      }
      if ($ace.SecurityIdentifier.Value -eq $user.Value) { $ownAccess = $true }
    } elseif ($ace.AceType -ne 'AccessDenied') {
      throw 'Unsupported ACL entry.'
    }
  }
  if (!$ownAccess) { throw 'ACL does not explicitly grant the current user access.' }
  if ($foreignAccess) {
    if ($pendingProtection) { $failureCode = 'EPIPEUNPROTECTED' }
    throw 'ACL grants another account access.'
  }
} catch {
  $failure = $_.Exception
  while ($failure.InnerException) { $failure = $failure.InnerException }
  if (!$failureCode) { $failureCode = $failure.NativeErrorCode }
  [Console]::Error.WriteLine((@{ message = $failure.Message; code = $failureCode } | ConvertTo-Json -Compress))
  exit 1
}
`
