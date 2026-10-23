import { raw } from '@tempad-dev/plugins'
import { expect, it } from 'vitest'

import { raw as sourceRaw } from '../../../plugins/src/index'

it('runs browser tests against the authored SDK', () => {
  expect(raw).toBe(sourceRaw)
})
