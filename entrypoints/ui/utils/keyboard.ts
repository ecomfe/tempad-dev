const metaKey = Reflect.getOwnPropertyDescriptor(MouseEvent.prototype, 'metaKey')!
const altKey = Reflect.getOwnPropertyDescriptor(MouseEvent.prototype, 'altKey')!

export function setLockMetaKey(lock: boolean) {
  if (lock) {
    Reflect.defineProperty(MouseEvent.prototype, 'metaKey', {
      get: () => true
    })
  } else {
    Reflect.defineProperty(MouseEvent.prototype, 'metaKey', metaKey)
  }
}

export function setLockAltKey(lock: boolean) {
  if (lock) {
    Reflect.defineProperty(MouseEvent.prototype, 'altKey', {
      get: () => true
    })
  } else {
    Reflect.defineProperty(MouseEvent.prototype, 'altKey', altKey)
  }
}
