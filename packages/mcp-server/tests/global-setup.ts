import type { TestProject } from 'vitest/node'

import { rmSync } from 'node:fs'

import { createPrivateTempDirectory } from '../src/runtime-platform'

declare module 'vitest' {
  export interface ProvidedContext {
    mcpTestDirectory: string
  }
}

export default async function setup(project: TestProject) {
  if (process.env.TEMPAD_RUNTIME_EVIDENCE_DIR) {
    const diagnostics = '../scripts/runtime-startup-trace.mjs'
    await import(diagnostics)
  }
  const directory = createPrivateTempDirectory('tempad-mcp-tests-')
  project.provide('mcpTestDirectory', directory)
  return () => rmSync(directory, { recursive: true, force: true })
}
