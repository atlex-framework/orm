/**
 * Exception thrown when a developer attempts to mass-assign a non-fillable attribute.
 */

export class MassAssignmentException extends Error {
  /**
   * @param modelName - Model class name.
   * @param key - Attribute name that was blocked.
   */
  public constructor(modelName: string, key: string) {
    super(`Add [${key}] to the fillable property of [${modelName}] to allow mass assignment`)
    this.name = 'MassAssignmentException'
  }
}
