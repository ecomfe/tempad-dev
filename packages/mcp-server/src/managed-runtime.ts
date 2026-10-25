#!/usr/bin/env node
import { fileURLToPath } from 'node:url'

import { runRuntime } from './runtime-prototype/run'

// Internal payload entry; the public CLI owns enrollment and migration.
await runRuntime(fileURLToPath(import.meta.url))
