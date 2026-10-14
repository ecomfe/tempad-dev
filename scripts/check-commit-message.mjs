import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('Expected the commit message file path.')
const subject = readFileSync(file, 'utf8').split(/\r?\n/, 1)[0]
// Git preserves the target's original subject in integration and autosquash commits.
const generated = /^(?:Merge |Revert "|(?:fixup|squash|amend)! \S)/.test(subject)
if (!generated && !/^[a-z]+(?:\([^()\r\n]+\))?!?: \S.*$/.test(subject)) {
  console.error(
    'Use a Conventional Commit subject, for example: fix(extension): preserve SVG placement'
  )
  process.exitCode = 1
}
