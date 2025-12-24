export function getVariableByIdCached(
  id: string,
  cache?: Map<string, Variable | null>
): Variable | null {
  if (!cache) return figma.variables.getVariableById(id)
  if (cache.has(id)) return cache.get(id) ?? null
  const variable = figma.variables.getVariableById(id)
  cache.set(id, variable ?? null)
  return variable ?? null
}
