import pretty from 'pino-pretty'

import { createLogDestination } from './log-destination.ts'

export default function logTransport(options: { destination: string; translateTime: string }) {
  const destination = createLogDestination(options.destination)
  try {
    const stream = pretty({ translateTime: options.translateTime, destination })
    destination.once('error', (error) => {
      // Pretty can finish its input before the last destination write fails.
      // Its pending close must not silently turn that write failure into success.
      if (stream.closed) return
      if (stream.destroyed) stream.emit('error', error)
      else stream.destroy(error)
    })
    return stream
  } catch (error) {
    destination.destroy()
    throw error
  }
}
