import type { TestProject } from 'vitest/node'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

declare module 'vitest' {
  export interface ProvidedContext {
    mcpTestDirectory: string
  }
}

export default function setup(project: TestProject) {
  const directory = mkdtempSync(join(tmpdir(), 'tempad-mcp-tests-'))
  project.provide('mcpTestDirectory', directory)
  return () => rmSync(directory, { recursive: true, force: true })
}
