import type { GetCodeLiteralCluster } from '@tempad-dev/shared'

import { canonicalizeColor } from '@/utils/css'

import type { VisibleTree } from './model'

const MAX_CLUSTERS = 6
const MAX_CONSUMERS_PER_CLUSTER = 3
const EXACT_HEX_COLOR = /^#(?:[\dA-Fa-f]{3}|[\dA-Fa-f]{4}|[\dA-Fa-f]{6}|[\dA-Fa-f]{8})$/

type MutableConsumer = {
  nodeId: string
  nodeName: string
  properties: Set<string>
}

type MutableCluster = {
  occurrences: number
  consumers: Map<string, MutableConsumer>
}

export function collectUnboundColorLiteralClusters(
  styles: ReadonlyMap<string, Record<string, string>>,
  tree: VisibleTree
): GetCodeLiteralCluster[] | undefined {
  const clusters = new Map<string, MutableCluster>()

  for (const [nodeId, style] of styles) {
    const snapshot = tree.nodes.get(nodeId)
    if (!snapshot) continue

    for (const [property, rawValue] of Object.entries(style)) {
      if (!isColorProperty(property) || rawValue.includes('var(')) continue
      const value = normalizeColorLiteral(rawValue)
      if (!value) continue

      const cluster = clusters.get(value) ?? {
        occurrences: 0,
        consumers: new Map<string, MutableConsumer>()
      }
      cluster.occurrences += 1

      const consumer = cluster.consumers.get(nodeId) ?? {
        nodeId,
        nodeName: normalizeNodeName(snapshot.name, snapshot.type),
        properties: new Set<string>()
      }
      consumer.properties.add(property)
      cluster.consumers.set(nodeId, consumer)
      clusters.set(value, cluster)
    }
  }

  const order = new Map(tree.order.map((nodeId, index) => [nodeId, index]))
  const result = Array.from(clusters, ([value, cluster]) => ({ value, cluster }))
    .filter(({ cluster }) => cluster.consumers.size >= 2)
    .sort(
      (left, right) =>
        right.cluster.occurrences - left.cluster.occurrences ||
        left.value.localeCompare(right.value, 'en')
    )
    .slice(0, MAX_CLUSTERS)
    .map(({ value, cluster }): GetCodeLiteralCluster => {
      const allConsumers = Array.from(cluster.consumers.values()).sort(
        (left, right) =>
          (order.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER) ||
          left.nodeId.localeCompare(right.nodeId, 'en')
      )
      const consumers = allConsumers.slice(0, MAX_CONSUMERS_PER_CLUSTER).map((consumer) => ({
        nodeId: consumer.nodeId,
        nodeName: consumer.nodeName,
        properties: Array.from(consumer.properties).sort((left, right) =>
          left.localeCompare(right, 'en')
        )
      }))
      const omittedConsumers = allConsumers.length - consumers.length

      return {
        kind: 'color',
        value,
        occurrences: cluster.occurrences,
        consumers,
        ...(omittedConsumers ? { omittedConsumers } : {})
      }
    })

  return result.length ? result : undefined
}

function isColorProperty(property: string): boolean {
  return (
    property === 'color' ||
    property === 'fill' ||
    property === 'stroke' ||
    property.endsWith('-color')
  )
}

function normalizeColorLiteral(value: string): string | undefined {
  const trimmed = value.trim()
  if (EXACT_HEX_COLOR.test(trimmed)) {
    return expandCanonicalHex(trimmed)
  }

  const canonical = canonicalizeColor(trimmed.toLowerCase())
  if (!canonical) return undefined
  const [hex, opacity] = canonical.split('/')
  if (!hex || !EXACT_HEX_COLOR.test(hex)) return undefined
  const expanded = expandCanonicalHex(hex)
  if (opacity === undefined) return expanded

  const percent = Number(opacity)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined
  if (percent === 100) return expanded
  const alpha = Math.round((percent / 100) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `${expanded}${alpha}`
}

function expandCanonicalHex(value: string): string {
  const digits = value.slice(1)
  const expanded =
    digits.length === 3 || digits.length === 4
      ? Array.from(digits, (character) => `${character}${character}`).join('')
      : digits
  return `#${expanded.toUpperCase()}`
}

function normalizeNodeName(name: string, type: SceneNode['type']): string {
  const normalized = name.replace(/\s+/g, ' ').trim()
  return (normalized || type).slice(0, 80)
}
