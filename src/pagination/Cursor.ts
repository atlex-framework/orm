import { InvalidCursorException } from '../exceptions/InvalidCursorException.js'

interface CursorPayload {
  parameters: Record<string, unknown>
  pointsToNext: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Opaque pagination cursor: URL-safe encoding of sort-column values and direction.
 */
export class Cursor {
  /**
   * @param parameters - Column values for compound `ORDER BY`, keyed by column name.
   * @param pointsToNext - When true, seek forward along the sort order; when false, seek backward.
   */
  public constructor(
    private readonly parameters: Record<string, unknown>,
    private readonly pointsToNext = true,
  ) {}

  /** Get a cursor parameter value by column name. */
  public parameter(name: string): unknown {
    return this.parameters[name]
  }

  /** All cursor parameters (column name → value). */
  public parametersMap(): Record<string, unknown> {
    return { ...this.parameters }
  }

  /** Whether this cursor seeks the next slice in sort order. */
  public pointsToNextItems(): boolean {
    return this.pointsToNext
  }

  /** Whether this cursor seeks the previous slice in sort order. */
  public pointsToPreviousItems(): boolean {
    return !this.pointsToNext
  }

  /**
   * Encode as base64url(JSON) for query strings.
   */
  public encode(): string {
    const payload: CursorPayload = {
      parameters: this.parameters,
      pointsToNext: this.pointsToNext,
    }
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  }

  /**
   * Decode a cursor produced by {@link Cursor.encode}.
   *
   * @throws InvalidCursorException when the payload is malformed.
   */
  public static decode(encodedString: string): Cursor {
    if (typeof encodedString !== 'string' || encodedString.trim().length === 0) {
      throw new InvalidCursorException('Cursor must be a non-empty string.')
    }
    let json: string
    try {
      json = Buffer.from(encodedString, 'base64url').toString('utf8')
    } catch {
      throw new InvalidCursorException('Cursor is not valid base64url.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(json) as unknown
    } catch {
      throw new InvalidCursorException('Cursor payload is not valid JSON.')
    }
    if (!isRecord(parsed)) {
      throw new InvalidCursorException('Cursor payload must be a JSON object.')
    }
    const params = parsed.parameters
    const pointsRaw = parsed.pointsToNext
    if (!isRecord(params)) {
      throw new InvalidCursorException('Cursor payload must include an object "parameters".')
    }
    if (typeof pointsRaw !== 'boolean') {
      throw new InvalidCursorException('Cursor payload must include boolean "pointsToNext".')
    }
    return new Cursor({ ...params }, pointsRaw)
  }

  /**
   * Build a cursor from a result row and the ordered sort columns.
   */
  public static fromItem(
    item: Record<string, unknown>,
    columns: string[],
    pointsToNext = true,
  ): Cursor {
    const parameters: Record<string, unknown> = {}
    for (const col of columns) {
      parameters[col] = item[col]
    }
    return new Cursor(parameters, pointsToNext)
  }
}
