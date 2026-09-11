import { describe, expect, it } from 'vitest'

import {
  isPathInside,
  parseLaunchctlLabels,
  parseProcessList,
  processBelongsToApp,
  processRunsRetiredHostHelper,
  resolveSwitchPaths,
  trashName
} from '@/scripts/switch-codex-host-runtime'

describe('Codex host switch runtime', () => {
  it('only permits retiring an app inside the user Applications directory', () => {
    expect(
      resolveSwitchPaths(
        '/Applications/ChatGPT.app',
        '/Users/test/Applications/ChatGPT Eval.app',
        '/Users/test'
      )
    ).toEqual({
      appPath: '/Applications/ChatGPT.app',
      retireAppPath: '/Users/test/Applications/ChatGPT Eval.app'
    })

    expect(() =>
      resolveSwitchPaths(
        '/Applications/ChatGPT.app',
        '/Applications/ChatGPT Eval.app',
        '/Users/test'
      )
    ).toThrow('must be inside')
    expect(() =>
      resolveSwitchPaths('/Applications/ChatGPT.app', '/Applications/ChatGPT.app', '/Users/test')
    ).toThrow('must be different')
  })

  it('matches only processes whose executable is inside the exact app bundle', () => {
    const appPath = '/Users/test/Applications/ChatGPT Eval.app'
    expect(
      processBelongsToApp(
        {
          command: `${appPath}/Contents/MacOS/ChatGPT --remote-debugging-port=9333`,
          pid: 10,
          ppid: 1
        },
        appPath
      )
    ).toBe(true)
    expect(
      processBelongsToApp(
        {
          command: `/bin/sh helper --app-path ${appPath}`,
          pid: 11,
          ppid: 1
        },
        appPath
      )
    ).toBe(false)
  })

  it('matches only reinstall helpers targeting the retired host', () => {
    const scriptPath = '/repo/packages/extension/scripts/reinstall-codex-dev-plugin.ts'
    const retireAppPath = '/Users/test/Applications/ChatGPT Eval.app'
    expect(
      processRunsRetiredHostHelper(
        {
          command: `/opt/node ${scriptPath} --app-path ${retireAppPath} --resume-after-restart`,
          pid: 12,
          ppid: 1
        },
        retireAppPath,
        scriptPath
      )
    ).toBe(true)
    expect(
      processRunsRetiredHostHelper(
        {
          command: `/opt/node ${scriptPath} --app-path /Applications/ChatGPT.app`,
          pid: 13,
          ppid: 1
        },
        retireAppPath,
        scriptPath
      )
    ).toBe(false)
  })

  it('parses the process list without truncating commands', () => {
    expect(
      parseProcessList(
        '  10     1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --flag value\n' +
          '  11    10 /Applications/ChatGPT.app/Contents/Resources/codex app-server\n'
      )
    ).toEqual([
      {
        command: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --flag value',
        pid: 10,
        ppid: 1
      },
      {
        command: '/Applications/ChatGPT.app/Contents/Resources/codex app-server',
        pid: 11,
        ppid: 10
      }
    ])
  })

  it('finds detached reinstall jobs by their exact launchctl prefix', () => {
    expect(
      parseLaunchctlLabels(
        '56937\t-15\tcom.tempad-dev.codex-plugin-reinstall.1\n' +
          '-\t0\tcom.tempad-dev.codex-host-switch.2\n',
        'com.tempad-dev.codex-plugin-reinstall.'
      )
    ).toEqual(['com.tempad-dev.codex-plugin-reinstall.1'])
  })

  it('builds recoverable, collision-safe Trash names', () => {
    expect(trashName('/Users/test/Applications/ChatGPT Eval.app', '20260816T060000Z')).toBe(
      'ChatGPT Eval - retired-20260816T060000Z.app'
    )
    expect(trashName('/Users/test/Applications/ChatGPT Eval.app', '20260816T060000Z', 2)).toBe(
      'ChatGPT Eval - retired-20260816T060000Z-2.app'
    )
  })

  it('distinguishes descendants from the directory itself and siblings', () => {
    expect(isPathInside('/Users/test/Applications', '/Users/test/Applications/App.app')).toBe(true)
    expect(isPathInside('/Users/test/Applications', '/Users/test/Applications')).toBe(false)
    expect(isPathInside('/Users/test/Applications', '/Users/test/Applications-old/App.app')).toBe(
      false
    )
  })
})
