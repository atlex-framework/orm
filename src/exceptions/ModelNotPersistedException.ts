/**
 * Exception thrown when a persistence-only action is called on an unsaved model.
 */

export class ModelNotPersistedException extends Error {
  public constructor() {
    super(
      'Cannot call delete() on a model that has not been saved to the database. Call save() first.',
    )
    this.name = 'ModelNotPersistedException'
  }
}
