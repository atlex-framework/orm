/**
 * Exception thrown when a model record cannot be found.
 */

export class ModelNotFoundException extends Error {
  public readonly modelName: string
  public readonly id: number | string

  /**
   * @param modelName - Model class name.
   * @param id - The primary key that was searched.
   */
  public constructor(modelName: string, id: number | string) {
    super(`No query results for model [${modelName}] with ID ${String(id)}`)
    this.name = 'ModelNotFoundException'
    this.modelName = modelName
    this.id = id
  }
}
