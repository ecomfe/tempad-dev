export type ScreenshotScenario = {
  group: 'inspect' | 'setup' | 'status'
  id: string
  mcpStatus?: string
  view: string
}

export function needsFixtureRuntime(scenarios: readonly ScreenshotScenario[]): boolean {
  return scenarios.some(({ group }) => group !== 'setup')
}

export function selectScenarios<T extends ScreenshotScenario>(
  scenarios: readonly T[],
  options: { group?: string | null; only?: string | null; capture?: boolean } = {}
): T[] {
  if (options.group && options.only) throw new Error('Use either --group or --only, not both.')
  if (options.group && !scenarios.some(({ group }) => group === options.group)) {
    throw new Error(`Unknown screenshot group: ${options.group}`)
  }
  const ids = options.only?.split(',').filter(Boolean)
  if (ids) {
    const unknown = ids.filter((id) => !scenarios.some((scenario) => scenario.id === id))
    if (unknown.length) throw new Error(`Unknown scenarios: ${unknown.join(', ')}`)
  }
  const selected = scenarios.filter((scenario) => {
    if (ids) return ids.includes(scenario.id)
    if (options.group) return scenario.group === options.group
    return !options.capture || !['inactive', 'unavailable'].includes(scenario.mcpStatus ?? '')
  })
  if (!selected.length) throw new Error('No scenarios selected.')
  if (
    options.capture &&
    selected.length > 1 &&
    selected.some(({ mcpStatus }) => ['inactive', 'unavailable'].includes(mcpStatus ?? ''))
  ) {
    throw new Error(
      'Capture MCP unavailable/inactive as a single --only scenario after preparing its state.'
    )
  }
  return selected
}

export function selectThemes(available: readonly string[], value: string | null): string[] {
  const selected = value === null ? [...available] : [...new Set(value.split(',').filter(Boolean))]
  if (!selected.length || selected.some((theme) => !available.includes(theme))) {
    throw new Error(`Themes must be one of: ${available.join(', ')}.`)
  }
  return selected
}
