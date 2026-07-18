import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')
const source = 'skill/SKILL.md'
const target = 'agent-plugins/tempad-dev/skills/figma-design-to-code/SKILL.md'
const sourcePath = join(root, source)
const targetPath = join(root, target)

const content = readFileSync(sourcePath, 'utf8')
const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null

if (current === content) {
  process.exit(0)
}

if (check) {
  console.error(`${target} is out of sync with ${source}. Run pnpm sync:agent-plugin.`)
  process.exit(1)
}

mkdirSync(dirname(targetPath), { recursive: true })
writeFileSync(targetPath, content)
console.log(`Synced ${target}.`)
