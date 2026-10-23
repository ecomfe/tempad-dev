import { core, z } from 'zod'

// Zod strips __proto__ before validating record entries. Keep its parser and
// JSON Schema projection, restoring that own key without invoking its setter.
const StringRecord = core.$constructor<z.ZodRecord<z.ZodString, z.ZodType>>(
  'StringRecord',
  (schema, definition) => {
    z.ZodRecord.init(schema, definition)
    const parse = schema._zod.parse
    schema._zod.parse = (payload, context) => {
      const input = payload.value
      const result = parse(payload, context)
      if (
        !core.util.isPlainObject(input) ||
        !Object.prototype.propertyIsEnumerable.call(input, '__proto__')
      )
        return result

      const key = definition.keyType._zod.run({ value: '__proto__', issues: [] }, context)
      if (key instanceof Promise)
        throw new Error('Async schemas not supported in object keys currently')
      if (key.issues.length) {
        payload.issues.push({
          code: 'invalid_key',
          origin: 'record',
          issues: key.issues.map((issue) => core.util.finalizeIssue(issue, context, core.config())),
          input: '__proto__',
          path: ['__proto__'],
          inst: schema
        })
        return result
      }

      const value = definition.valueType._zod.run({ value: input.__proto__, issues: [] }, context)
      const restore = (parsed: core.ParsePayload) => {
        payload.issues.push(...core.util.prefixIssues('__proto__', parsed.issues))
        Object.defineProperty(payload.value, '__proto__', {
          value: parsed.value,
          enumerable: true,
          configurable: true,
          writable: true
        })
        // Declaration order chooses defaults such as the first variable mode.
        // Move following entries behind the restored key without replacing the
        // object retained by Zod's recursive-parser memoization.
        const keys = Object.keys(input)
        for (const key of keys.slice(keys.indexOf('__proto__') + 1)) {
          const property = Object.getOwnPropertyDescriptor(payload.value, key)
          if (!property) continue
          delete payload.value[key]
          Object.defineProperty(payload.value, key, property)
        }
        return payload
      }
      return result instanceof Promise || value instanceof Promise
        ? Promise.all([result, value]).then(([, parsed]) => restore(parsed))
        : restore(value)
    }
  }
)

/** Internal dictionary schema for unmodified string keys (length/pattern checks only).
 * Keep key normalization and enumerated-key semantics out of this helper. */
export function stringRecord<Key extends z.ZodString, Value extends z.ZodType>(
  keyType: Key,
  valueType: Value
): z.ZodRecord<Key, Value> {
  return new StringRecord({ type: 'record', keyType, valueType }) as unknown as z.ZodRecord<
    Key,
    Value
  >
}
