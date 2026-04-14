/**
 * Query-layer exception thrown when the underlying SQL engine/driver fails.
 * Includes the compiled SQL and bindings for debugging.
 */

export class QueryException extends Error {
  public readonly sql: string
  public readonly bindings: readonly unknown[]
  public override readonly cause: Error

  /**
   * Create a new QueryException.
   *
   * @param message - Actionable description of what failed.
   * @param sql - Compiled SQL string that was executed.
   * @param bindings - Bindings used for the SQL statement.
   * @param cause - The original driver error.
   */
  public constructor(message: string, sql: string, bindings: readonly unknown[], cause: Error) {
    super(message)
    this.name = 'QueryException'
    this.sql = sql
    this.bindings = bindings
    this.cause = cause
  }
}
