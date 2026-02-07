import { describe, expect, it } from 'vitest'

import {
  buildAssetFilename,
  getHashFromAssetFilename,
  getImageExtension,
  normalizeMimeType
} from '../src/asset-utils'

describe('asset-utils', () => {
  it('normalizes mime types with params and casing', () => {
    expect(normalizeMimeType('IMAGE/PNG; charset=UTF-8')).toBe('image/png')
    expect(normalizeMimeType('  text/plain  ')).toBe('text/plain')
    expect(normalizeMimeType(undefined)).toBe('application/octet-stream')
    expect(normalizeMimeType('')).toBe('application/octet-stream')
    expect(normalizeMimeType(' ;bad')).toBe('')
    expect(normalizeMimeType('; charset=UTF-8')).toBe('application/octet-stream')
  })

  it('derives image extensions with override and suffix handling', () => {
    expect(getImageExtension('image/jpeg')).toBe('.jpg')
    expect(getImageExtension('image/svg+xml')).toBe('.svg')
    expect(getImageExtension('image/+xml')).toBe('.+xml')
    expect(getImageExtension('image/png')).toBe('.png')
    expect(getImageExtension('text/plain')).toBe('')
    expect(getImageExtension('image/')).toBe('')
  })

  it('builds asset filenames and parses hashes', () => {
    expect(buildAssetFilename('a1b2c3d4', 'image/png')).toBe('a1b2c3d4.png')
    expect(buildAssetFilename('a1b2c3d4', 'application/octet-stream')).toBe('a1b2c3d4')

    expect(getHashFromAssetFilename('a1b2c3d4')).toBe('a1b2c3d4')
    expect(getHashFromAssetFilename('A1B2C3D4.JPG')).toBe('A1B2C3D4')
    expect(getHashFromAssetFilename('too-short.png')).toBeNull()
    expect(getHashFromAssetFilename('a1b2c3d4.bad-ext!')).toBeNull()
  })
})
