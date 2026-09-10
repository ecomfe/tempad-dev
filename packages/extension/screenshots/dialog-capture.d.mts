import type { CDPSession } from 'playwright'

export function captureDialogPng(
  send: CDPSession['send'],
  clip: { x: number; y: number; width: number; height: number; scale: number }
): Promise<{ data: string }>
