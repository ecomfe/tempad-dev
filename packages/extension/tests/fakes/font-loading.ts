export function createFontLoadingFixture(
  loadFont: (font: FontName) => Promise<void> = async () => undefined
) {
  const loaded = new Map<string, Set<string>>()

  function requireLoadedFont(font: FontName, operation = 'use'): void {
    if (!loaded.get(font.family)?.has(font.style)) {
      throw new Error(`Cannot ${operation}: font ${font.family}/${font.style} is not loaded`)
    }
  }

  return {
    async loadFontAsync(font: FontName): Promise<void> {
      await loadFont(font)
      const styles = loaded.get(font.family) ?? new Set<string>()
      styles.add(font.style)
      loaded.set(font.family, styles)
    },
    requireLoadedFont,
    resolveBoundFont(
      current: FontName,
      field: string,
      variable: Variable | null,
      consumer: SceneNode
    ): FontName {
      if (!variable || (field !== 'fontFamily' && field !== 'fontStyle')) return current
      const value = variable.resolveForConsumer(consumer).value
      if (typeof value !== 'string') throw new Error('Expected a string font variable')
      const next = { ...current, [field === 'fontFamily' ? 'family' : 'style']: value }
      requireLoadedFont(next, `bind ${field}`)
      return next
    }
  }
}
