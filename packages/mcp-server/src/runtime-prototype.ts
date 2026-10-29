#!/usr/bin/env node
import { fileURLToPath } from 'node:url'

import { runRuntime } from './runtime-prototype/run'

await runRuntime(fileURLToPath(import.meta.url))
