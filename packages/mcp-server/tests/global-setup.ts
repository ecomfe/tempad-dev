import type { TestProject } from 'vitest/node'

import { rmSync } from 'node:fs'

import { createPrivateTempDirectory } from '../src/runtime-platform'

declare module 'vitest' {
  export interface ProvidedContext {
    mcpTestDirectory: string
  }
}

export default function setup(project: TestProject) {
  const directory = createPrivateTempDirectory('tempad-mcp-tests-')
  project.provide('mcpTestDirectory', directory)
  return () => rmSync(directory, { recursive: true, force: true })
}
