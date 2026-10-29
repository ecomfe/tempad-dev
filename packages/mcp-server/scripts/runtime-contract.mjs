import { createHash } from 'node:crypto'

export function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  )
}

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas'
])
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SCHEMA_VALUES = new Set([
  'items',
  'additionalItems',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'contentSchema'
])

function schemaContract(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !['description', 'title', '$comment'].includes(key))
      .map(([key, value]) => {
        if (SCHEMA_MAPS.has(key))
          value = Object.fromEntries(
            Object.entries(value).map(([name, child]) => [name, schemaContract(child)])
          )
        else if (SCHEMA_LISTS.has(key) || (key === 'items' && Array.isArray(value)))
          value = value.map(schemaContract)
        else if (SCHEMA_VALUES.has(key)) value = schemaContract(value)
        // Values under const, enum, default and extension keywords are data, not schemas.
        return [key, value]
      })
  )
}

function catalogContract(item) {
  const { description: _description, title: _title, inputSchema, outputSchema, ...wire } = item
  if (inputSchema !== undefined) wire.inputSchema = schemaContract(inputSchema)
  if (outputSchema !== undefined) wire.outputSchema = schemaContract(outputSchema)
  // Unknown fields and annotations stay wire-significant, even when only display-related.
  return wire
}

function ordered(items, key) {
  const names = items.map((item) => item[key])
  if (names.some((name) => typeof name !== 'string') || new Set(names).size !== names.length)
    throw new Error(`Catalog entries need unique ${key} values.`)
  return [...items].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0))
}

/** A conservative structural screen, never an activation or guidance-compatibility decision. */
export function runtimeContract(snapshot) {
  const { serverInfo, instructions, ...initialization } = snapshot.initialize
  const { version: _version, ...serverPresentation } = serverInfo
  const catalogs = Object.fromEntries(
    [
      ['tools', 'name'],
      ['resources', 'uri'],
      ['resourceTemplates', 'uriTemplate'],
      ['prompts', 'name']
    ].map(([name, key]) => [name, ordered(snapshot[name] ?? [], key)])
  )
  const wire = {
    initialize: initialization,
    ...Object.fromEntries(
      Object.entries(catalogs).map(([name, items]) => [name, items.map(catalogContract)])
    )
  }
  // Keep the full advertised snapshot for review; wire changes can also change this hash.
  const presentation = { serverInfo: serverPresentation, instructions, ...catalogs }
  return { wire, presentation, wireHash: digest(wire), presentationHash: digest(presentation) }
}

export function compareContracts(before, after) {
  if (before.wireHash !== after.wireHash) return 'wire-changed'
  return before.presentationHash === after.presentationHash ? 'identical' : 'presentation-only'
}

export function compareReleaseWindow(results) {
  return results.slice(0, -1).flatMap((before, start) =>
    results.slice(start + 1).map((after, offset) => {
      const intermediate = results.slice(start, start + offset + 2)
      const [fromMajor, fromMinor] = before.version.split('.').map(Number)
      const [toMajor, toMinor] = after.version.split('.').map(Number)
      return {
        from: before.version,
        to: after.version,
        adjacent: offset === 0,
        structural: compareContracts(before, after),
        wireUnchangedThroughout: intermediate.every((item) => item.wireHash === before.wireHash),
        breakingReleaseBoundary:
          fromMajor !== toMajor || (fromMajor === 0 && fromMinor !== toMinor),
        guidance: 'unreviewed',
        activation: 'not-established'
      }
    })
  )
}

export function summarize(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error('Measurement samples must be nonempty and finite.')
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1]
  return {
    samples: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1)
  }
}
