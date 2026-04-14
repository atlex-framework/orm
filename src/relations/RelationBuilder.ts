/**
 * Relationship builders for `@atlex/orm`.
 *
 * A `RelationBuilder` is a thin wrapper around `QueryBuilder` that captures
 * relationship metadata used for eager loading and provides a typed, lazy API.
 */

import type { Model } from '../Model.js'
import type { QueryBuilder } from '../QueryBuilder.js'

export type RelationType =
  | 'hasOne'
  | 'hasMany'
  | 'belongsTo'
  | 'belongsToMany'
  | 'hasManyThrough'
  | 'hasOneThrough'

export interface RelationMeta {
  type: RelationType
  name: string

  parent: Model
  related: typeof Model

  foreignKey?: string
  localKey?: string

  ownerKey?: string

  pivotTable?: string
  pivotForeignKey?: string
  pivotRelatedKey?: string
}

export class RelationBuilder<TRelated extends Model> {
  public constructor(
    protected readonly query: QueryBuilder<TRelated>,
    protected readonly meta: RelationMeta,
  ) {}

  /**
   * Access underlying query builder.
   *
   * @returns The wrapped `QueryBuilder`.
   * @example
   * user.posts().getQuery().latest().limit(10)
   */
  public getQuery(): QueryBuilder<TRelated> {
    return this.query
  }

  /**
   * Relationship metadata (used for eager loading).
   *
   * @returns Metadata.
   */
  public getMeta(): RelationMeta {
    return this.meta
  }

  /**
   * Fetch related models.
   *
   * @returns Related models.
   * @example
   * const posts = await user.posts().get()
   */
  public async get(): Promise<TRelated[]> {
    return await this.query.get<TRelated>()
  }

  /**
   * Fetch the first related model.
   *
   * @returns First related model or null.
   * @example
   * const profile = await user.profile().first()
   */
  public async first(): Promise<TRelated | null> {
    return await this.query.first<TRelated>()
  }

  /**
   * Fetch the first related model or fail.
   */
  public async firstOrFail(): Promise<TRelated> {
    return await this.query.firstOrFail<TRelated>()
  }

  /**
   * Pass-through to underlying query builder methods.
   * This keeps relations lazy by default.
   */
  public select(...columns: string[]): this {
    this.query.select(...columns)
    return this
  }

  public where(column: string, operator: string, value: unknown): this
  public where(column: string, value: unknown): this
  public where(callback: (qb: QueryBuilder) => void): this
  public where(a: string | ((qb: QueryBuilder) => void), b?: string | unknown, c?: unknown): this {
    if (typeof a === 'function') {
      this.query.where((qb) => {
        a(qb)
      })
      return this
    }
    if (typeof b === 'string' && arguments.length === 3) {
      this.query.where(a, b, c)
      return this
    }
    this.query.where(a, b)
    return this
  }

  public orderBy(column: string, direction?: 'asc' | 'desc'): this {
    this.query.orderBy(column, direction)
    return this
  }

  public latest(column?: string): this {
    this.query.latest(column)
    return this
  }

  public limit(n: number): this {
    this.query.limit(n)
    return this
  }
}
