import { z } from 'zod'

// Frozen receiving contract from extension 0.20.0 / MCP 0.7.1
// (7cfcb877d673c0eb161bbac04fc87435a4ce4672).
// Do not import current shared schemas: additions must fail this old peer.
export const MessageToExtensionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('registered'), id: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('state'),
      activeId: z.string().nullable(),
      assetServerUrl: z.string().url()
    })
    .strict(),
  z
    .object({
      type: z.literal('toolCall'),
      id: z.string().min(1),
      payload: z.object({ name: z.string(), args: z.unknown() }).strict()
    })
    .strict()
])

export const structure = {
  roots: [{ id: '1:2', name: 'Legacy frame', type: 'FRAME', x: 0, y: 0, width: 320, height: 240 }]
}

export function codeResult(asset) {
  return {
    code: `<img src="${asset.url}" />`,
    lang: 'jsx',
    assets: [asset],
    tokens: { '--color-primary': { kind: 'color', value: '#663399' } },
    codegen: { plugin: 'default', config: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
  }
}
