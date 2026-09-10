import { describe, expect, it } from 'vitest'

import {
  needsFixtureRuntime,
  selectScenarios,
  selectThemes,
  type ScreenshotScenario
} from '../../scripts/screenshot-plan'

const scenarios: ScreenshotScenario[] = [
  { id: 'code', group: 'inspect', view: 'code' },
  { id: 'mcp-config', group: 'setup', view: 'mcpInstall' },
  { id: 'mcp-config-gemini', group: 'setup', view: 'mcpInstall' },
  { id: 'mcp-active', group: 'status', view: 'mcpStatus', mcpStatus: 'active' },
  { id: 'mcp-inactive', group: 'status', view: 'mcpStatus', mcpStatus: 'inactive' },
  { id: 'mcp-unavailable', group: 'status', view: 'mcpStatus', mcpStatus: 'unavailable' }
]

describe('marketing screenshot selection', () => {
  it('can refresh agent setup without initializing or modifying canvas fixtures', () => {
    const setup = selectScenarios(scenarios, { group: 'setup', capture: true })
    expect(setup.map(({ id }) => id)).toEqual(['mcp-config', 'mcp-config-gemini'])
    expect(needsFixtureRuntime(setup)).toBe(false)
    expect(needsFixtureRuntime(selectScenarios(scenarios, { only: 'code,mcp-config' }))).toBe(true)
  })

  it('keeps state-gated captures out of defaults but includes them in review and verification', () => {
    expect(selectScenarios(scenarios, { capture: true }).map(({ id }) => id)).toEqual([
      'code',
      'mcp-config',
      'mcp-config-gemini',
      'mcp-active'
    ])
    expect(selectScenarios(scenarios)).toEqual(scenarios)
    expect(selectScenarios(scenarios, { only: 'mcp-inactive', capture: true })).toEqual([
      scenarios[4]
    ])
    expect(() => selectScenarios(scenarios, { group: 'status', capture: true })).toThrow(
      'single --only'
    )
  })

  it('rejects ambiguous and misspelled selection before touching browser or published files', () => {
    expect(() => selectScenarios(scenarios, { group: 'setup', only: 'code' })).toThrow('either')
    expect(() => selectScenarios(scenarios, { group: 'typo' })).toThrow('Unknown screenshot group')
    expect(() => selectScenarios(scenarios, { only: 'code,typo' })).toThrow('Unknown scenarios')
    expect(() => selectScenarios(scenarios, { only: '' })).toThrow('No scenarios')
  })

  it('supports a one-theme capture, comparison, and promotion without requiring the other theme', () => {
    expect(selectThemes(['light', 'dark'], 'light')).toEqual(['light'])
    expect(selectThemes(['light', 'dark'], null)).toEqual(['light', 'dark'])
    expect(selectThemes(['light', 'dark'], 'dark,dark')).toEqual(['dark'])
    expect(() => selectThemes(['light', 'dark'], '')).toThrow('Themes must')
    expect(() => selectThemes(['light', 'dark'], 'light,typo')).toThrow('Themes must')
  })
})
