/**
 * Exception thrown when accessing a relation that hasn't been eager-loaded.
 */

export class RelationNotLoadedException extends Error {
  public constructor(modelName: string, relation: string) {
    super(
      `Attempted to access relation [${relation}] on [${modelName}] but it has not been loaded. Did you forget to use with('${relation}')?`,
    )
    this.name = 'RelationNotLoadedException'
  }
}
