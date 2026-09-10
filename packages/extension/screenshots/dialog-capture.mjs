// Capture the real dialog on a transparent surface. No raster masking or UI reconstruction.
// Every temporary browser override is removed before returning, including after failure.
const captureStyle = `
html, body { background: transparent !important; }
body * { visibility: hidden !important; }
tempad .tp-dialog-panel, tempad .tp-dialog-panel * { visibility: visible !important; }
tempad .tp-dialog-overlay { background: transparent !important; }
tempad .tp-dialog-panel { box-shadow: none !important; }
`

export async function captureDialogPng(send, clip) {
  const expression = `(() => {
    const style = document.createElement('style');
    style.id = 'tempad-dialog-capture';
    style.textContent = ${JSON.stringify(captureStyle)};
    document.head.append(style);
  })()`
  try {
    const prepared = await send('Runtime.evaluate', { expression })
    if (prepared.exceptionDetails)
      throw new Error('Could not isolate the setup dialog for capture.')
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    return await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip })
  } finally {
    try {
      await send('Runtime.evaluate', {
        expression: "document.querySelector('#tempad-dialog-capture')?.remove()"
      })
    } finally {
      await send('Emulation.setDefaultBackgroundColorOverride', {})
    }
  }
}
