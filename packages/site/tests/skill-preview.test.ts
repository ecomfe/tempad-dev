import { describe, expect, it } from 'vitest'

import { renderSkillPreview } from '../scripts/skill-preview'

const root = 'https://github.com/ecomfe/tempad-dev/blob/main/skill/'
const files = new Map([
  [`${root}SKILL.md`, 'SKILL.md'],
  [`${root}references/assets.md`, 'references/assets.md'],
  [`${root}references/recovery.md`, 'references/recovery.md']
])

describe('multi-file skill previews', () => {
  it('keeps root-to-reference, sibling, and parent links inside the preview', () => {
    const entry = renderSkillPreview(
      '[Assets](references/assets.md#tokens)',
      `${root}SKILL.md`,
      files
    )
    expect(entry.html).toContain('data-skill-file="references/assets.md"')
    expect(entry.html).toContain('data-skill-anchor="#tokens"')
    expect(entry.html).toContain(`href="${root}references/assets.md#tokens"`)
    expect(entry.html).not.toContain('target="_blank"')

    const reference = renderSkillPreview(
      '[Recover](recovery.md) [Home](../SKILL.md)',
      `${root}references/assets.md`,
      files
    )
    expect(reference.html).toContain('data-skill-file="references/recovery.md"')
    expect(reference.html).toContain('data-skill-file="SKILL.md"')
  })

  it('provides anchors for subsection links and matches duplicate heading suffixes', () => {
    const preview = renderSkillPreview(
      '[Go](#tokens-1)\n\n## Assets\n\n### Tokens\n\n### Tokens',
      `${root}references/assets.md`,
      files
    )
    expect(preview.html).toContain('id="tokens"')
    expect(preview.html).toContain('id="tokens-1"')
    expect(preview.html).toContain(
      'data-skill-file="references/assets.md" data-skill-anchor="#tokens-1"'
    )
    expect(preview.toc).toEqual([{ depth: 2, id: 'assets', text: 'Assets' }])
  })

  it('preserves external and out-of-package links without inventing local files', () => {
    const preview = renderSkillPreview(
      '[External](https://example.com/docs) [Outside](../README.md) [Missing](missing.md)',
      `${root}SKILL.md`,
      files
    )
    expect(preview.html).not.toContain('data-skill-file')
    expect(preview.html.match(/target="_blank"/g)).toHaveLength(3)
    expect(preview.html).toContain('https://github.com/ecomfe/tempad-dev/blob/main/README.md')
  })

  it('leaves code examples as code rather than navigable links', () => {
    const preview = renderSkillPreview(
      '```md\n[Assets](references/assets.md)\n```',
      `${root}SKILL.md`,
      files
    )
    expect(preview.html).not.toContain('data-skill-file')
    expect(preview.html).toContain('<pre><code')
  })
})
