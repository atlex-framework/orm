/**
 * Exception thrown when a requested database record is not found.
 */

export class NotFoundException extends Error {
  /**
   * Create a new NotFoundException.
   *
   * @param message - Description of the missing record.
   */
  public constructor(message: string) {
    super(message)
    this.name = 'NotFoundException'
  }
}
