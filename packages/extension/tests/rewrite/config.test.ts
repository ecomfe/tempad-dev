import { describe, expect, it } from 'vitest'

import { GROUPS } from '@/rewrite/config'

function applyFirstReplacement(groupIndex: number, input: string): string {
  const replacement = GROUPS[groupIndex].replacements[0]
  return input.replace(replacement.pattern as string | RegExp, replacement.replacer as string)
}

describe('rewrite/config', () => {
  it('defines rewrite groups with stable marker contracts', () => {
    expect(GROUPS).toHaveLength(3)
    expect(GROUPS[0].markers).toEqual(['.appModel.isReadOnly'])
    expect(GROUPS[1].markers).toEqual(['{type:"global",closePluginFunc:'])
    expect(GROUPS[2].markers).toEqual(['let{canRunExtensions:'])
  })

  it('applies configured replacement rules for readonly and dev-mode unlock flows', () => {
    expect(applyFirstReplacement(0, 'if(.appModel.isReadOnly){x()}')).toBe(
      'if(.appModel.__isReadOnly__){x()}'
    )

    expect(applyFirstReplacement(1, 'const x={type:"global",closePluginFunc:abc};void x;')).toBe(
      'const x={type:"global",closePluginFunc:()=>{}};void x;'
    )

    expect(
      applyFirstReplacement(
        2,
        'let{canRunExtensions:a,canAccessFullDevMode:b}=c.openFile;return a&&b;'
      )
    ).toBe('let{canRunExtensions:a,canAccessFullDevMode:b}=c.openFile;a=true;return a&&b;')
  })
})
