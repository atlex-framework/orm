/**
 * Thrown when a cursor string cannot be decoded or fails validation.
 */
export class InvalidCursorException extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'InvalidCursorException'
  }
}
