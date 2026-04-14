/**
 * Soft deletes mixin for `@atlex/orm`.
 *
 * Usage:
 * class User extends SoftDeletes(Model) { static table = 'users' }
 *
 * Adds a global scope to exclude soft-deleted rows and provides helpers for
 * querying trashed records as well as restoring/force deleting.
 */

import { ModelNotPersistedException } from '../exceptions/ModelNotPersistedException.js'
import { type Model } from '../Model.js'
import type { QueryBuilder } from '../QueryBuilder.js'

const SOFT_DELETE_SCOPE = 'softDeletes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConstructor<T> = abstract new (...args: any[]) => T

export function SoftDeletes<TBase extends AnyConstructor<Model>>(
  Base: TBase,
): AnyConstructor<Model> {
  abstract class SoftDeletesModel extends Base {
    // Required for TS mixin typing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public constructor(...args: any[]) {
      super(...args)
    }

    /**
     * Boot the soft delete global scope once.
     */
    public static booted(): void {
      const superBooted = (Base as unknown as typeof Model).booted
      if (typeof superBooted === 'function') superBooted.call(this)
      ;(this as unknown as typeof Model).addGlobalScope(SOFT_DELETE_SCOPE, {
        apply(builder: QueryBuilder) {
          builder.whereNull('deleted_at')
        },
      })
    }

    /**
     * Include trashed records in the query.
     */
    public static withTrashed(this: typeof Model) {
      return (
        this as unknown as typeof Model & {
          withoutGlobalScope: (name: string) => QueryBuilder<Model>
        }
      ).withoutGlobalScope(SOFT_DELETE_SCOPE)
    }

    /**
     * Only return trashed records.
     */
    public static onlyTrashed(this: typeof Model) {
      return (
        this as unknown as typeof Model & {
          withoutGlobalScope: (name: string) => QueryBuilder<Model>
        }
      )
        .withoutGlobalScope(SOFT_DELETE_SCOPE)
        .whereNotNull('deleted_at')
    }

    /**
     * Soft delete the model by setting `deleted_at`.
     */
    public override async delete(): Promise<void> {
      if (!this.exists()) throw new ModelNotPersistedException()
      this.setAttribute('deleted_at', new Date())
      await this.save()
    }

    /**
     * Permanently delete the record.
     */
    public override async forceDelete(): Promise<void> {
      await super.delete()
    }

    /**
     * Restore a soft-deleted record.
     */
    public override async restore(): Promise<void> {
      if (!this.exists()) throw new ModelNotPersistedException()
      await (this.constructor as typeof Model).callRestoringHook(this)
      this.setAttribute('deleted_at', null)
      await this.save()
      await (this.constructor as typeof Model).callRestoredHook(this)
    }

    // Note: truncate() remains on the base Model class.
  }

  return SoftDeletesModel
}
