/**
 * Exception thrown when an unsafe database operation is attempted in production.
 */

export class DangerousOperationException extends Error {
  public constructor() {
    super('truncate() is not allowed in production. Set ALLOW_UNSAFE_OPERATIONS=true to override.')
    this.name = 'DangerousOperationException'
  }
}
