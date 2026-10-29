import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('Expected the commit message file path.')
const subject = execFileSync('git', ['stripspace', '--strip-comments'], {
  input: readFileSync(file, 'utf8'),
  encoding: 'utf8'
}).split('\n', 1)[0]
// Git preserves the target's original subject in integration and autosquash commits.
const generated = /^(?:Merge |(?:Revert|Reapply) "|(?:fixup|squash|amend)! \S)/.test(subject)
if (!generated && !/^[a-z]+(?:\([^()\r\n]+\))?!?: \S.*$/.test(subject)) {
  console.error(
    'Use a Conventional Commit subject, for example: fix(extension): preserve SVG placement'
  )
  process.exitCode = 1
}
