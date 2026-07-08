export type McpBrokerPort = ReturnType<typeof browser.runtime.connect>

export type McpBrokerSession = {
  port: McpBrokerPort
  sessionId: string
}

export class McpSessionRegistry {
  private activeSessionId: string | null = null
  private readonly sessions = new Map<string, McpBrokerSession>()

  get size(): number {
    return this.sessions.size
  }

  getActiveId(): string | null {
    return this.activeSessionId
  }

  getActive(): McpBrokerSession | null {
    return this.activeSessionId ? (this.sessions.get(this.activeSessionId) ?? null) : null
  }

  get(sessionId: string): McpBrokerSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  list(): McpBrokerSession[] {
    return [...this.sessions.values()]
  }

  register(session: McpBrokerSession): void {
    this.sessions.set(session.sessionId, session)
    this.autoActivateSoleSession()
  }

  unregister(sessionId: string): void {
    this.sessions.delete(sessionId)
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null
    }
    this.autoActivateSoleSession()
  }

  activate(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false
    this.activeSessionId = sessionId
    return true
  }

  private autoActivateSoleSession(): void {
    if (this.activeSessionId && this.sessions.has(this.activeSessionId)) {
      return
    }
    const [sessionId] = this.sessions.keys()
    this.activeSessionId = this.sessions.size === 1 ? sessionId : null
  }
}
