import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { reinstallInApp, resumeThreadInApp } from '@/scripts/reinstall-codex-dev-plugin-ui'

let browser: Browser
let page: Page
const version = '0.5.8+codex.fixture'
const threadId = '019a1234-5678-7abc-8def-123456789abc'

beforeAll(async () => {
  browser = await chromium.launch()
})
beforeEach(async () => {
  page = await browser.newPage()
  page.setDefaultTimeout(2000)
})
afterEach(async () => {
  await page.close()
})
afterAll(async () => {
  await browser?.close()
})

async function pluginFixture(installed = true) {
  await page.setContent(`
    <main><h1>TemPad Dev (Dev)</h1><p>${version}</p>
      <button id="actions" ${installed ? '' : 'hidden'}>More actions</button>
      <button id="install" ${installed ? 'hidden' : ''}>Install plugin</button>
      <div role="menu" hidden><button role="menuitem">Uninstall</button></div>
      <div role="dialog" hidden><button>Uninstall</button></div>
    </main>
    <script>
      const actions = document.querySelector('#actions');
      const install = document.querySelector('#install');
      const menu = document.querySelector('[role=menu]');
      const dialog = document.querySelector('[role=dialog]');
      window.events = [];
      actions.onclick = () => menu.hidden = false;
      menu.querySelector('button').onclick = () => { menu.hidden = true; dialog.hidden = false; };
      dialog.querySelector('button').onclick = () => {
        window.events.push('uninstalled'); dialog.hidden = true; actions.hidden = true; install.hidden = false;
      };
      install.onclick = () => {
        window.events.push('installed'); actions.hidden = false; install.hidden = true;
      };
    </script>`)
}

describe('plugin UI reinstall ordering (isolated Chromium)', () => {
  it('uninstalls before process verification and installs only after it completes', async () => {
    await pluginFixture()
    await reinstallInApp(page, version, async () => {
      expect(
        await page.getByRole('button', { name: 'Install plugin', exact: true }).isVisible()
      ).toBe(true)
      await page.evaluate(() => {
        ;(window as unknown as { events: string[] }).events.push('runtime-stopped')
      })
    })
    expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual([
      'uninstalled',
      'runtime-stopped',
      'installed'
    ])
  })

  it('leaves the plugin uninstalled when disk or process verification fails', async () => {
    await pluginFixture()
    await expect(
      reinstallInApp(page, version, async () => {
        throw new Error('process respawned')
      })
    ).rejects.toThrow('process respawned')
    expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual([
      'uninstalled'
    ])
  })

  it('checks runtime exit even when the plugin is already absent', async () => {
    await pluginFixture(false)
    const afterUninstall = vi.fn(async () => {})
    await reinstallInApp(page, version, afterUninstall)
    expect(afterUninstall).toHaveBeenCalledOnce()
  })
})

async function taskFixture({
  draft = '',
  running = false,
  acknowledged = true,
  richText = false
} = {}) {
  await page.route('https://codex.fixture/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<main><div id="transcript"></div><div data-codex-composer-root>
      ${richText ? '<div contenteditable="true"></div>' : '<textarea></textarea>'}<button>${running ? 'Stop' : 'Send'}</button>
    </div></main>
    <script>
      const editor = document.querySelector('textarea, [contenteditable]');
      const property = ${richText ? "'textContent'" : "'value'"};
      editor[property] = ${JSON.stringify(draft)};
      document.querySelector('button').onclick = () => {
        if (!${acknowledged}) return;
        const message = document.createElement('p');
        message.textContent = editor[property];
        document.querySelector('#transcript').append(message);
        editor[property] = '';
      };
    </script>`
    })
  )
  const navigate = page.goto.bind(page)
  // Chromium has no Electron app: protocol. Only its navigation is adapted;
  // locators, clicks, drafts and transcript acknowledgement use a real browser DOM.
  const goto = vi.fn((url: string) => navigate(url.replace('app://-', 'https://codex.fixture')))
  const adapted = new Proxy(page, {
    get(target, key) {
      if (key === 'url') return () => 'app://-/index.html?window=main'
      if (key === 'goto') return goto
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  return { adapted, goto }
}

describe('task recovery UI (isolated Chromium)', () => {
  it.each([false, true])(
    'loads the saved task and confirms one continuation (rich text: %s)',
    async (richText) => {
      const { adapted, goto } = await taskFixture({ richText })
      const message = 'Continue the authorized runtime refresh.'
      const beforeSend = vi.fn(async () => {
        expect(await page.locator('#transcript').innerText()).toBe('')
      })
      expect(await resumeThreadInApp(adapted, threadId, message, beforeSend)).toBe('sent')
      expect(new URL(goto.mock.calls[0]![0]).searchParams.get('initialRoute')).toBe(
        `/local/${threadId}`
      )
      expect(beforeSend).toHaveBeenCalledOnce()
      expect(await page.locator('#transcript > p').allTextContents()).toEqual([message])
    }
  )

  it('does not overwrite the restored draft', async () => {
    const { adapted } = await taskFixture({ draft: 'User draft' })
    const beforeSend = vi.fn()
    await expect(resumeThreadInApp(adapted, threadId, 'Continue', beforeSend)).rejects.toThrow(
      'draft'
    )
    expect(await page.locator('textarea').inputValue()).toBe('User draft')
    expect(beforeSend).not.toHaveBeenCalled()
  })

  it('does not send another prompt to an already-running task', async () => {
    const { adapted } = await taskFixture({ running: true })
    const beforeSend = vi.fn()
    expect(await resumeThreadInApp(adapted, threadId, 'Continue', beforeSend)).toBe(
      'already-running'
    )
    expect(beforeSend).not.toHaveBeenCalled()
  })

  it('does not submit if the uncertainty record could not be saved', async () => {
    const { adapted } = await taskFixture()
    await expect(
      resumeThreadInApp(adapted, threadId, 'Continue', async () => {
        throw new Error('ENOSPC')
      })
    ).rejects.toThrow('ENOSPC')
    expect(await page.locator('#transcript').innerText()).toBe('')
  })

  it.each([false, true])(
    'does not mistake an unsubmitted draft for acknowledgement (rich text: %s)',
    async (richText) => {
      const { adapted } = await taskFixture({ acknowledged: false, richText })
      const beforeSend = vi.fn(async () => {})
      await expect(resumeThreadInApp(adapted, threadId, 'Continue', beforeSend)).rejects.toThrow(
        'Timeout'
      )
      expect(beforeSend).toHaveBeenCalledOnce()
      expect(await page.locator('#transcript').innerText()).toBe('')
    }
  )
})
