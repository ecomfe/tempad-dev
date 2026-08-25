import { describe, expect, it } from 'vitest'

import { extractSkillCatalog, fingerprintSkillCatalog } from '@/scripts/inspect-agent-skill-catalog'

const catalog = `<skills_instructions>
## Skills
- imagegen: Generate images. (file: /system/imagegen/SKILL.md)
- tempad-dev-dev:figma-canvas-authoring: Create Figma designs. (file: /plugins/tempad/0.1+codex.a/skills/figma-canvas-authoring/SKILL.md)
</skills_instructions>`

function rollout(text: string): string {
  return `${JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text }] }
  })}\n`
}

describe('agent skill catalog inspection', () => {
  it('extracts ordered skill metadata and the exact TemPad runtime path', () => {
    const skills = extractSkillCatalog(rollout(catalog))
    const result = fingerprintSkillCatalog(skills)

    expect(skills.map((skill) => skill.name)).toEqual([
      'imagegen',
      'tempad-dev-dev:figma-canvas-authoring'
    ])
    expect(result.count).toBe(2)
    expect(result.catalogFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.runtimeFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.tempadSkillPaths).toEqual([
      '/plugins/tempad/0.1+codex.a/skills/figma-canvas-authoring/SKILL.md'
    ])
  })

  it('separates ambient catalog identity from versioned runtime identity', () => {
    const first = fingerprintSkillCatalog(extractSkillCatalog(rollout(catalog)))
    const second = fingerprintSkillCatalog(
      extractSkillCatalog(rollout(catalog.replace('+codex.a', '+codex.b')))
    )

    expect(first.catalogFingerprint).toBe(second.catalogFingerprint)
    expect(first.runtimeFingerprint).not.toBe(second.runtimeFingerprint)
  })

  it('fails when the rollout has no complete catalog', () => {
    expect(() => extractSkillCatalog(rollout('no skills here'))).toThrow(
      'No complete <skills_instructions> catalog found'
    )
  })
})
