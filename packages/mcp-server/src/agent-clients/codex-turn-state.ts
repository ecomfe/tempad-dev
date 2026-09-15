export type CodexTurn = { turnId: string; status: string }
export type CodexLifecycleState = { turns: CodexTurn[] }
type Turn = Partial<CodexTurn>

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Unsupported Codex lifecycle value.')
  return value as Record<string, unknown>
}

function turn(value: unknown): Turn {
  const source = object(value)
  const result: Turn = {}
  for (const field of ['turnId', 'status'] as const) {
    const value = source[field]
    if (value == null) continue
    if (typeof value !== 'string') throw new Error('Unsupported Codex turn field.')
    result[field] = value
  }
  return result
}

/** A projection of the native stream, containing no messages or tool results. */
export class CodexTurnState {
  private legacy?: Turn[]
  private canonical?: Map<string, Turn>
  private kind?: string

  constructor(
    value: unknown,
    private readonly conversationId: string
  ) {
    this.snapshot(value)
  }

  private snapshot(value: unknown): void {
    const state = object(value)
    if (state.id !== this.conversationId) throw new Error('Unexpected Codex conversation snapshot.')
    this.legacy = Array.isArray(state.turns) ? state.turns.map(turn) : undefined
    this.history(state.turnHistory)
  }

  private entities(value: unknown): void {
    this.canonical = new Map(
      Object.entries(object(value)).map(([key, value]) => [key, turn(value)])
    )
  }

  private history(value: unknown): void {
    this.setKind(value == null ? undefined : object(value).kind)
    this.canonical = undefined
    if (this.kind === 'canonical') this.entities(object(object(value).history).entitiesByKey)
  }

  private setKind(value: unknown): void {
    if (value !== undefined && value !== 'canonical' && value !== 'legacy')
      throw new Error('Unsupported Codex history kind.')
    this.kind = value
  }

  state(): CodexLifecycleState {
    const entries = this.kind === 'canonical' ? this.canonical?.values() : this.legacy
    if (!entries) throw new Error('Unsupported Codex turn history.')
    const turns: CodexTurn[] = []
    for (const entry of entries) {
      if (typeof entry.turnId === 'string' && typeof entry.status === 'string')
        turns.push({ turnId: entry.turnId, status: entry.status })
    }
    return { turns }
  }

  /** Publish only after the entire batch succeeds; discard this projection on failure. */
  apply(patches: unknown[]): boolean {
    let changed = false
    for (const value of patches) {
      const patch = object(value)
      const path = patch.path
      if (!Array.isArray(path)) throw new Error('Unsupported Codex state patch.')
      if (path.length && !['id', 'turns', 'turnHistory'].includes(path[0])) continue
      if (path[0] === 'turns' && path.length > 2 && !['turnId', 'status'].includes(path[2]))
        continue
      if (path[0] === 'turnHistory' && path.length > 1) {
        if (!['kind', 'history'].includes(path[1])) continue
        if (path[1] === 'history' && path.length > 2 && path[2] !== 'entitiesByKey') continue
        if (path.length > 4 && !['turnId', 'status'].includes(path[4])) continue
      }
      const op = patch.op
      if (typeof op !== 'string' || !['add', 'replace', 'remove'].includes(op))
        throw new Error('Unsupported Codex lifecycle operation.')
      changed = true
      const next = op === 'remove' ? undefined : patch.value
      if (!path.length) this.snapshot(next)
      else if (path[0] === 'id') {
        if (path.length !== 1 || next !== this.conversationId)
          throw new Error('Unexpected Codex conversation patch.')
      } else if (path[0] === 'turns') this.patchLegacy(path, op, next)
      else this.patchHistory(path, op, next)
    }
    return changed
  }

  private patchLegacy(path: unknown[], op: string, next: unknown): void {
    if (path.length === 1) {
      if (next !== undefined && !Array.isArray(next)) throw new Error('Unsupported Codex turns.')
      this.legacy = next?.map(turn)
      return
    }
    const entries = this.legacy
    if (!entries) throw new Error('Missing Codex turns.')
    const index = path[1]
    if (index === 'length' && path.length === 2 && op === 'replace') {
      if (
        typeof next !== 'number' ||
        !Number.isSafeInteger(next) ||
        next < 0 ||
        next > entries.length
      )
        throw new Error('Unsupported Codex turn array length.')
      entries.length = next
      return
    }
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > entries.length
    )
      throw new Error('Unsupported Codex turn index.')
    if (path.length === 2 && op === 'add') {
      entries.splice(index, 0, turn(next))
      return
    }
    if (index === entries.length) throw new Error('Missing Codex turn.')
    if (path.length > 2) this.field(entries[index], path.slice(2), next)
    else if (op === 'remove') entries.splice(index, 1)
    else entries[index] = turn(next)
  }

  private patchHistory(path: unknown[], op: string, next: unknown): void {
    if (path.length === 1) {
      this.history(next)
      return
    }
    if (path[1] === 'kind' && path.length === 2) {
      this.setKind(next)
      return
    }
    if (path[1] !== 'history') throw new Error('Unsupported Codex lifecycle path.')
    if (path.length <= 3) {
      this.canonical = undefined
      if (next !== undefined) this.entities(path.length === 2 ? object(next).entitiesByKey : next)
      return
    }
    const entries = this.canonical
    const key = path[3]
    if (!entries || typeof key !== 'string') throw new Error('Unsupported Codex turn key.')
    if (path.length === 4) {
      if (op === 'remove') entries.delete(key)
      else entries.set(key, turn(next))
      return
    }
    const entry = entries.get(key)
    if (!entry) throw new Error('Missing Codex turn.')
    this.field(entry, path.slice(4), next)
  }

  private field(entry: Turn, path: unknown[], value: unknown): void {
    const field = path[0]
    if (path.length !== 1 || (field !== 'turnId' && field !== 'status'))
      throw new Error('Unsupported Codex turn field path.')
    if (value == null) delete entry[field]
    else if (typeof value === 'string') entry[field] = value
    else throw new Error('Unsupported Codex turn field.')
  }
}
