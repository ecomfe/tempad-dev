import { describe, expect, it } from 'vitest'

import { bundledRuntime, rewriteSource } from '@/rewrite/transform'

describe('shared rewrite transform', () => {
  it('retains the Figma reference after applying a supplied patch', () => {
    const source = 'window.figma=api;delete window.figma;delete window.figma;'
    expect(
      rewriteSource(source, [
        { markers: ['window.figma=api'], replacements: [{ pattern: '=api', replacer: '=saved' }] }
      ])
    ).toBe('window.figma=saved;window.figma = undefined;window.figma = undefined;')
  })

  it('provides the packaged patches and target matcher when the remote runtime is unavailable', () => {
    expect(
      new RegExp(bundledRuntime.targetPattern).test(
        'https://www.figma.com/webpack-artifacts/assets/entry.min.js'
      )
    ).toBe(true)
    expect(bundledRuntime.rewrite('if(model.appModel.isReadOnly)locked();', 'entry.min.js')).toBe(
      'if(model.appModel.__isReadOnly__)locked();'
    )
    expect(bundledRuntime.rewrite('window.unrelated = 1;', 'entry.min.js')).toBe(
      'window.unrelated = 1;'
    )
  })
})
