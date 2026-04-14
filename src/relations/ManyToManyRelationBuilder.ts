/**
 * Many-to-many relationship builder for `@atlex/orm`.
 *
 * Extends `RelationBuilder` with pivot-table operations like attach/detach/sync
 * and pivot filtering/selection helpers.
 */

import type { Model } from '../Model.js'
import type { QueryBuilder } from '../QueryBuilder.js'
import type { PivotData } from '../types.js'

import { RelationBuilder, type RelationMeta } from './RelationBuilder.js'

interface SyncResult {
  attached: (number | string)[]
  detached: (number | string)[]
  updated: (number | string)[]
}

export class ManyToManyRelationBuilder<TRelated extends Model> extends RelationBuilder<TRelated> {
  private pivotColumns: string[] = []
  private pivotTimestamps = false
  private pivotWheres: ((qb: QueryBuilder<TRelated>) => void)[] = []
  private pivotOrders: ((qb: QueryBuilder<TRelated>) => void)[] = []

  public constructor(query: QueryBuilder<TRelated>, meta: RelationMeta) {
    super(query, meta)
  }

  /**
   * Include pivot columns in the result set. They will be hydrated onto `model.pivot`.
   *
   * @param columns - Pivot columns to include.
   * @returns this
   * @example
   * user.roles().withPivot('assigned_at')
   */
  public withPivot(...columns: string[]): this {
    this.pivotColumns.push(...columns)
    return this
  }

  /**
   * Include `created_at` and `updated_at` from the pivot table.
   *
   * @returns this
   * @example
   * user.roles().withTimestamps()
   */
  public withTimestamps(): this {
    this.pivotTimestamps = true
    return this
  }

  /**
   * Add a pivot WHERE constraint.
   */
  public wherePivot(column: string, operator: string, value: unknown): this {
    const meta = this.getMeta()
    if (!meta.pivotTable)
      throw new Error('ManyToManyRelationBuilder error: missing pivot table metadata.')
    this.pivotWheres.push((qb) => {
      qb.where(`${meta.pivotTable}.${column}`, operator, value)
    })
    return this
  }

  /**
   * Add a pivot ORDER BY constraint.
   */
  public orderByPivot(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    const meta = this.getMeta()
    if (!meta.pivotTable)
      throw new Error('ManyToManyRelationBuilder error: missing pivot table metadata.')
    this.pivotOrders.push((qb) => {
      qb.orderBy(`${meta.pivotTable}.${column}`, direction)
    })
    return this
  }

  /**
   * Attach related ids to the parent via the pivot table.
   *
   * @param ids - Related id or ids.
   * @param pivotData - Additional pivot columns.
   * @returns void
   * @example
   * await user.roles().attach([1,2], { assigned_at: new Date() })
   */
  public async attach(
    ids: number | string | (number | string)[],
    pivotData: PivotData = {},
  ): Promise<void> {
    const meta = this.getMeta()
    const pivotTable = meta.pivotTable
    const fk = meta.pivotForeignKey
    const rk = meta.pivotRelatedKey
    if (!pivotTable || !fk || !rk) {
      throw new Error('ManyToManyRelationBuilder.attach() missing pivot metadata.')
    }

    const parentCtor = meta.parent.constructor as typeof Model
    const parentId = meta.parent.getAttribute(parentCtor.primaryKey) as number | string | null
    if (parentId === null || parentId === undefined) {
      throw new Error(
        'ManyToManyRelationBuilder.attach() requires the parent model to have a primary key value.',
      )
    }

    const list = Array.isArray(ids) ? ids : [ids]
    const now = new Date()
    const rows = list.map((id) => {
      const base: Record<string, unknown> = {
        [fk]: parentId,
        [rk]: id,
        ...pivotData,
      }
      if (this.pivotTimestamps) {
        base.created_at = now
        base.updated_at = now
      }
      return base
    })

    // Uses QueryBuilder directly; no model hooks.
    await (parentCtor as unknown as { query: () => QueryBuilder })
      .query()
      .table(pivotTable)
      .insert(rows)
  }

  /**
   * Detach related ids (or all when none provided).
   */
  public async detach(ids?: (number | string)[]): Promise<void> {
    const meta = this.getMeta()
    const pivotTable = meta.pivotTable
    const fk = meta.pivotForeignKey
    const rk = meta.pivotRelatedKey
    if (!pivotTable || !fk || !rk)
      throw new Error('ManyToManyRelationBuilder.detach() missing pivot metadata.')

    const parentCtor = meta.parent.constructor as typeof Model
    const parentId = meta.parent.getAttribute(parentCtor.primaryKey) as number | string | null
    if (parentId === null || parentId === undefined) {
      throw new Error(
        'ManyToManyRelationBuilder.detach() requires the parent model to have a primary key value.',
      )
    }

    const q = (parentCtor as unknown as { query: () => QueryBuilder })
      .query()
      .table(pivotTable)
      .where(fk, parentId)
    if (ids && ids.length > 0) q.whereIn(rk, ids)
    await q.delete()
  }

  /**
   * Sync related ids against the pivot.
   */
  public async sync(ids: (number | string)[], detaching = true): Promise<SyncResult> {
    const meta = this.getMeta()
    const pivotTable = meta.pivotTable
    const fk = meta.pivotForeignKey
    const rk = meta.pivotRelatedKey
    if (!pivotTable || !fk || !rk)
      throw new Error('ManyToManyRelationBuilder.sync() missing pivot metadata.')

    const parentCtor = meta.parent.constructor as typeof Model
    const parentPk = parentCtor.primaryKey
    const parentId = meta.parent.getAttribute(parentPk) as number | string | null
    if (parentId === null || parentId === undefined) {
      throw new Error(
        'ManyToManyRelationBuilder.sync() requires the parent model to have a primary key value.',
      )
    }

    const base = (parentCtor as unknown as { query: () => QueryBuilder })
      .query()
      .table(pivotTable)
      .where(fk, parentId)
    const existing = await base.clone().pluck<number | string>(rk)

    const want = new Set(ids.map(String))
    const have = new Set(existing.map(String))

    const toAttach = ids.filter((id) => !have.has(String(id)))
    const toDetach = detaching ? existing.filter((id) => !want.has(String(id))) : []

    if (toAttach.length > 0) await this.attach(toAttach)
    if (toDetach.length > 0) await this.detach(toDetach)

    return { attached: toAttach, detached: toDetach, updated: [] }
  }

  public async syncWithoutDetaching(ids: (number | string)[]): Promise<void> {
    await this.sync(ids, false)
  }

  public async toggle(ids: (number | string)[]): Promise<void> {
    const meta = this.getMeta()
    const pivotTable = meta.pivotTable
    const fk = meta.pivotForeignKey
    const rk = meta.pivotRelatedKey
    if (!pivotTable || !fk || !rk)
      throw new Error('ManyToManyRelationBuilder.toggle() missing pivot metadata.')

    const parentCtor = meta.parent.constructor as typeof Model
    const parentId = meta.parent.getAttribute(parentCtor.primaryKey) as number | string | null
    if (parentId === null || parentId === undefined) {
      throw new Error(
        'ManyToManyRelationBuilder.toggle() requires the parent model to have a primary key value.',
      )
    }

    const existing = await (parentCtor as unknown as { query: () => QueryBuilder })
      .query()
      .table(pivotTable)
      .where(fk, parentId)
      .whereIn(rk, ids)
      .pluck<number | string>(rk)

    const existingSet = new Set(existing.map(String))
    const toAttach = ids.filter((id) => !existingSet.has(String(id)))
    const toDetach = ids.filter((id) => existingSet.has(String(id)))

    if (toAttach.length > 0) await this.attach(toAttach)
    if (toDetach.length > 0) await this.detach(toDetach)
  }

  public async updateExistingPivot(id: number | string, data: PivotData): Promise<void> {
    const meta = this.getMeta()
    const pivotTable = meta.pivotTable
    const fk = meta.pivotForeignKey
    const rk = meta.pivotRelatedKey
    if (!pivotTable || !fk || !rk)
      throw new Error('ManyToManyRelationBuilder.updateExistingPivot() missing pivot metadata.')

    const parentCtor = meta.parent.constructor as typeof Model
    const parentId = meta.parent.getAttribute(parentCtor.primaryKey) as number | string | null
    if (parentId === null || parentId === undefined) {
      throw new Error(
        'ManyToManyRelationBuilder.updateExistingPivot() requires the parent model to have a primary key value.',
      )
    }

    await (parentCtor as unknown as { query: () => QueryBuilder })
      .query()
      .table(pivotTable)
      .where(fk, parentId)
      .where(rk, id)
      .update(data)
  }
}
