export function collectVariableAliasIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableAliasIds(item, ids))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (record.type === 'VARIABLE_ALIAS' && typeof record.id === 'string') {
    ids.add(record.id)
    return
  }
  Object.values(record).forEach((item) => collectVariableAliasIds(item, ids))
}
