import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'

import { stringRecord } from '../../src/mcp/string-record'

const dictionary = <Value>(value: Value) => Object.fromEntries([['__proto__', value]])

describe('string dictionaries', () => {
  it('retains declaration order when the prototype-like key is first, middle, or last', () => {
    const schema = stringRecord(z.string(), z.string())
    for (const keys of [
      ['__proto__', 'first', 'second'],
      ['first', '__proto__', 'second'],
      ['first', 'second', '__proto__']
    ]) {
      const input = Object.fromEntries(keys.map((key) => [key, key]))
      const parsed = schema.parse(input)
      expect(Object.keys(parsed)).toEqual(keys)
      expect(parsed).toEqual(input)
    }
  })

  it('validates own enumerable keys without changing prototypes or the input', () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"polluted":false},"prototype":{"polluted":true}}'
    )
    const parsed = stringRecord(z.string(), z.object({ polluted: z.boolean() })).parse(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(parsed.__proto__).not.toBe(input.__proto__)
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype)
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)

    const hidden = Object.defineProperty({ normal: true }, '__proto__', { value: false })
    expect(stringRecord(z.string(), z.boolean()).parse(hidden)).toEqual({ normal: true })
  })

  it('preserves optional, cloned, described, and refined schemas and their value types', () => {
    const transform = vi.fn((value: string) => value.length)
    const schema = stringRecord(z.string(), z.string().transform(transform))
      .clone()
      .describe('Dictionary')
      .refine((value) => Object.keys(value).length === 1)
      .optional()
    expect(schema.parse(undefined)).toBeUndefined()
    expect(schema.parse(dictionary('text'))).toEqual(dictionary(4))
    expect(schema.parse({ normal: 'plain' })).toEqual({ normal: 5 })
    expect(schema.safeParse({}).success).toBe(false)
    expect(transform.mock.calls.map(([value]) => value)).toEqual(['text', 'plain'])
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<Record<string, string> | undefined>()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Record<string, number> | undefined>()
  })

  it('reports invalid inputs and values at their original dictionary paths', () => {
    const schema = z.object({ data: stringRecord(z.string(), z.number()) })
    expect(schema.safeParse({ data: null }).success).toBe(false)
    const result = schema.safeParse({ data: dictionary('invalid') })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues).toEqual([
        expect.objectContaining({ code: 'invalid_type', path: ['data', '__proto__'] })
      ])
    const constrainedKeys = stringRecord(z.string().regex(/^__proto__$/), z.number())
    const invalidKey = constrainedKeys.safeParse({ ...dictionary(1), invalid: 2 })
    expect(invalidKey.success).toBe(false)
    if (!invalidKey.success)
      expect(invalidKey.error.issues).toEqual([
        expect.objectContaining({ code: 'invalid_key', path: ['invalid'] })
      ])
  })

  it('supports asynchronous value validation for prototype-like and ordinary keys', async () => {
    const schema = stringRecord(
      z.string(),
      z.string().transform(async (value) => value.length)
    )
    expect(await schema.parseAsync(dictionary('text'))).toEqual(dictionary(4))
    const parsed = await schema.parseAsync({ ...dictionary('text'), normal: 'normal' })
    expect(parsed).toEqual({ ...dictionary(4), normal: 6 })
    expect(Object.keys(parsed)).toEqual(['__proto__', 'normal'])
    expect(() => schema.parse(dictionary('text'))).toThrow(/Promise/)
  })

  it('rejects asynchronous key validation consistently with Zod records', async () => {
    const schema = stringRecord(
      z.string().refine(async () => true),
      z.string()
    )
    await expect(schema.parseAsync(dictionary('text'))).rejects.toThrow(
      'Async schemas not supported in object keys currently'
    )
    expect(() => schema.parse(dictionary('text'))).toThrow(/Promise/)
  })

  it.each(['draft-7', 'draft-2020-12'] as const)(
    'preserves %s input/output projections, including tuple values',
    (target) => {
      const key = z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\w./:-]+$/)
      const value = z.tuple([z.string(), z.number()])
      for (const io of ['input', 'output'] as const)
        expect(z.toJSONSchema(stringRecord(key, value), { target, io })).toEqual(
          z.toJSONSchema(z.record(key, value), { target, io })
        )
    }
  )
})
