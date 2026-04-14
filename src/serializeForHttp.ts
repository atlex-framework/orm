import { Model } from './Model.js'

/**
 * Recursively turn models (and arrays / nested objects containing models) into JSON-safe plain data for `res.json()`.
 *
 * @param value - Any value returned from a controller or service.
 * @returns Plain data suitable for `JSON.stringify` / Express `res.json`.
 */
export function serializeForHttp(value: unknown): unknown {
  if (value instanceof Model) {
    return value.toJSON()
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeForHttp(item))
  }
  if (value !== null && typeof value === 'object') {
    const withJson = value as { toJSON?: () => unknown }
    if (typeof withJson.toJSON === 'function') {
      return withJson.toJSON()
    }
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      out[key] = serializeForHttp(obj[key])
    }
    return out
  }
  return value
}
