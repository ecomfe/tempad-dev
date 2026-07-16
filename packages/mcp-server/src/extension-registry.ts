import type { ExtensionConnection } from './types'

type TimeoutHandle = ReturnType<typeof setTimeout>

export class ExtensionRegistry {
  readonly #autoActivateGraceMs: number
  readonly #extensions: ExtensionConnection[] = []
  #activeId: string | null = null
  #autoActivateTimer: TimeoutHandle | null = null

  constructor(autoActivateGraceMs: number) {
    this.#autoActivateGraceMs = autoActivateGraceMs
  }

  get size(): number {
    return this.#extensions.length
  }

  add(extension: ExtensionConnection): void {
    if (this.#extensions.some(({ id }) => id === extension.id)) {
      throw new Error(`Extension connection already registered: ${extension.id}`)
    }
    this.#extensions.push(extension)
  }

  remove(id: string): { extension: ExtensionConnection; wasActive: boolean } | null {
    const index = this.#extensions.findIndex((extension) => extension.id === id)
    if (index < 0) return null
    this.clearAutoActivation()
    const extension = this.#extensions[index]!
    this.#extensions.splice(index, 1)
    const wasActive = this.#activeId === id
    if (wasActive) this.#activeId = null
    return { extension, wasActive }
  }

  activate(id: string): boolean {
    const target = this.#extensions.find((extension) => extension.id === id)
    if (!target) return false

    const active = this.getActive()
    if (active && active.id !== target.id && active.origin !== target.origin) return false

    this.#activeId = id
    return true
  }

  getActive(): ExtensionConnection | undefined {
    return this.#extensions.find((extension) => extension.id === this.#activeId)
  }

  getActiveId(): string | null {
    return this.#activeId
  }

  list(): readonly ExtensionConnection[] {
    return this.#extensions
  }

  scheduleAutoActivation(onActivated: (id: string) => void): void {
    this.clearAutoActivation()
    if (this.#extensions.length !== 1 || this.getActive()) return

    const targetId = this.#extensions[0]!.id
    this.#autoActivateTimer = setTimeout(() => {
      this.#autoActivateTimer = null
      if (this.#extensions.length !== 1 || this.getActiveId() || !this.activate(targetId)) return
      onActivated(targetId)
    }, this.#autoActivateGraceMs)
    unrefTimer(this.#autoActivateTimer)
  }

  clearAutoActivation(): void {
    if (!this.#autoActivateTimer) return
    clearTimeout(this.#autoActivateTimer)
    this.#autoActivateTimer = null
  }

  dispose(): void {
    this.clearAutoActivation()
  }
}

function unrefTimer(timer: TimeoutHandle): void {
  if (typeof timer !== 'object' || timer === null) return
  const handle = timer as NodeJS.Timeout
  if (typeof handle.unref === 'function') handle.unref()
}
