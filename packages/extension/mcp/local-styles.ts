export async function getLocalStyles(): Promise<BaseStyle[]> {
  return (
    await Promise.all([
      figma.getLocalPaintStylesAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
      figma.getLocalGridStylesAsync()
    ])
  ).flat()
}
