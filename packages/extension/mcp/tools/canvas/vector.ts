import type { CanvasFigmaVectorPath } from '@tempad-dev/shared'

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const ARGUMENT_COUNTS = {
  M: 2,
  L: 2,
  Q: 4,
  C: 6,
  Z: 0
} as const

type PathCommand = keyof typeof ARGUMENT_COUNTS

function numberToken(token: string | undefined): number {
  if (!token || !NUMBER_PATTERN.test(token)) {
    throw new Error(`Expected a finite path number, received "${token ?? ''}".`)
  }
  const value = Number(token)
  if (!Number.isFinite(value)) throw new Error(`Path number "${token}" is not finite.`)
  return Object.is(value, -0) ? 0 : value
}

function formatNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value)
}

function canonicalVectorPathData(data: string): string {
  const tokens = data.trim().split(/\s+/)
  const output: string[] = []
  let current: { x: number; y: number } | undefined
  let subpathStart: { x: number; y: number } | undefined

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++]!
    if (!Object.hasOwn(ARGUMENT_COUNTS, token)) {
      throw new Error(`Unsupported vector path command "${token}".`)
    }
    const command = token as PathCommand
    const count = ARGUMENT_COUNTS[command]
    if (tokens.length - index < count) {
      throw new Error(`Vector path command "${command}" requires ${count} numbers.`)
    }
    const values = tokens.slice(index, index + count).map(numberToken)
    index += count

    if (command === 'M') {
      current = { x: values[0]!, y: values[1]! }
      subpathStart = current
      output.push(command, ...values.map(formatNumber))
      continue
    }
    if (!current || !subpathStart) {
      throw new Error(`Vector path command "${command}" requires a preceding M command.`)
    }
    if (command === 'Z') {
      current = subpathStart
      output.push(command)
      continue
    }
    if (command === 'L') {
      current = { x: values[0]!, y: values[1]! }
      output.push(command, ...values.map(formatNumber))
      continue
    }
    if (command === 'Q') {
      const control = { x: values[0]!, y: values[1]! }
      const end = { x: values[2]!, y: values[3]! }
      const cubic = [
        current.x + (2 / 3) * (control.x - current.x),
        current.y + (2 / 3) * (control.y - current.y),
        end.x + (2 / 3) * (control.x - end.x),
        end.y + (2 / 3) * (control.y - end.y),
        end.x,
        end.y
      ]
      current = end
      output.push('C', ...cubic.map(formatNumber))
      continue
    }
    current = { x: values[4]!, y: values[5]! }
    output.push(command, ...values.map(formatNumber))
  }

  if (!output.length) throw new Error('Vector path data cannot be empty.')
  return output.join(' ')
}

export function canonicalVectorPaths(
  paths: readonly CanvasFigmaVectorPath[]
): CanvasFigmaVectorPath[] {
  return paths.map((path) => ({ ...path, data: canonicalVectorPathData(path.data) }))
}

export function vectorPathsEqual(
  current: readonly VectorPath[],
  desired: readonly CanvasFigmaVectorPath[]
): boolean {
  if (current.length !== desired.length) return false
  try {
    return current.every(
      (path, index) =>
        path.windingRule === desired[index]!.windingRule &&
        canonicalVectorPathData(path.data) === canonicalVectorPathData(desired[index]!.data)
    )
  } catch {
    return false
  }
}
