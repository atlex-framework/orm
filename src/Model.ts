/**
 * Active Record `Model` base class for `@atlex/orm`.
 *
 * Responsibility:
 * - Attribute storage, dirty tracking, mass assignment rules
 * - Persistence (`save`, `delete`, `restore`) delegating to `QueryBuilder`
 * - Relationships (hasOne/hasMany/belongsTo/belongsToMany/through variants)
 * - Eager loading (`with`, `withCount`) with batched queries (no N+1)
 * - Scopes (global + local scope macros)
 * - Hooks/observers lifecycle events
 *
 * Usage example:
 * ```ts
 * class User extends SoftDeletes(Model) {
 *   static table = 'users'
 *   static hidden = ['password']
 *   static fillable = ['name', 'email', 'password']
 *
 *   getFullNameAttribute() { return `${this.first_name} ${this.last_name}` }
 *
 *   posts()   { return this.hasMany(Post, 'user_id') }
 *   profile() { return this.hasOne(Profile, 'user_id') }
 *   roles()   { return this.belongsToMany(Role, 'role_user').withPivot('assigned_at') }
 *
 *   scopeActive(qb: QueryBuilder) { return qb.where('active', '=', true) }
 * }
 *
 * const user = await User.findOrFail(1)
 * const posts = await user.posts().where('published', '=', true).latest().get()
 * const users = await User.with('posts', 'profile').active().get()
 * ```
 */

import { db } from './db.js'
import { DangerousOperationException } from './exceptions/DangerousOperationException.js'
import { MassAssignmentException } from './exceptions/MassAssignmentException.js'
import { ModelNotFoundException } from './exceptions/ModelNotFoundException.js'
import { ModelNotPersistedException } from './exceptions/ModelNotPersistedException.js'
import { RelationNotLoadedException } from './exceptions/RelationNotLoadedException.js'
import type { CursorPaginator } from './pagination/CursorPaginator.js'
import type { LengthAwarePaginator } from './pagination/LengthAwarePaginator.js'
import type { CursorPaginationOptions, PaginationOptions } from './pagination/PaginationMeta.js'
import type { Paginator } from './pagination/Paginator.js'
import { type QueryBuilder } from './QueryBuilder.js'
import { ManyToManyRelationBuilder } from './relations/ManyToManyRelationBuilder.js'
import { RelationBuilder } from './relations/RelationBuilder.js'
import type { Scope } from './scopes/Scope.js'
import type { ModelConstructor } from './types.js'

type Attributes = Record<string, unknown>
type ModelClass<T extends Model> = ModelConstructor<T> & typeof Model

type HookName =
  | 'creating'
  | 'created'
  | 'updating'
  | 'updated'
  | 'saving'
  | 'saved'
  | 'deleting'
  | 'deleted'
  | 'restoring'
  | 'restored'

type HookHandler = (arg: unknown) => unknown | Promise<unknown>

const bootedModels = new Set<Function>()
const globalScopes = new WeakMap<Function, Map<string, Scope>>()
const observers = new WeakMap<Function, object[]>()

function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function pascalCase(value: string): string {
  return value
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const aObj = typeof a === 'object' && a !== null
  const bObj = typeof b === 'object' && b !== null
  if (aObj || bObj) {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

function ensureTable(model: typeof Model): void {
  if (typeof model.table !== 'string' || model.table.trim().length === 0) {
    throw new Error(`Model configuration error: static table must be set on [${model.name}].`)
  }
}

function ensureBooted(model: typeof Model): void {
  if (bootedModels.has(model)) return
  bootedModels.add(model)
  model.booted()
}

function getGlobalScopes(model: typeof Model): Map<string, Scope> {
  const existing = globalScopes.get(model)
  if (existing) return existing
  const m = new Map<string, Scope>()
  globalScopes.set(model, m)
  return m
}

function getObservers(model: typeof Model): object[] {
  const existing = observers.get(model)
  if (existing) return existing
  const list: object[] = []
  observers.set(model, list)
  return list
}

export abstract class Model {
  // Subclass must define these
  public static table: string
  public static primaryKey = 'id'
  public static timestamps = true
  public static incrementing = true
  public static hidden: string[] = []
  public static fillable: string[] = []
  public static guarded: string[] = ['id']
  public static appends: string[] = []

  /** When > 0, `new Model()` returns the raw instance so `hydrate` can assign private fields; caller re-wraps with the attribute proxy. */
  static #hydrateDepth = 0

  // Internal state
  #exists = false
  #original: Attributes = {}
  #attributes: Attributes = {}
  #relations: Record<string, unknown> = {}
  #lastChanges: Attributes = {};

  // Dynamic property access
  [key: string]: unknown

  static #attributeProxyHandler(): ProxyHandler<Model> {
    return {
      get: (target, prop, receiver) => {
        if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
        if (Reflect.has(target, prop)) {
          // Use `target` as receiver so getters see the real instance; bind methods so `this` is not the Proxy (private fields live on the target).
          const value = Reflect.get(target, prop, target)
          return typeof value === 'function' ? value.bind(target) : value
        }

        if (prop in target.#relations) return target.#relations[prop]

        return target.getAttribute(prop)
      },
      set: (target, prop, value, receiver) => {
        if (typeof prop === 'symbol') return Reflect.set(target, prop, value, receiver)
        if (Reflect.has(target, prop)) return Reflect.set(target, prop, value, receiver)

        target.setAttribute(prop, value)
        return true
      },
      has: (target, prop) => {
        if (typeof prop === 'symbol') return Reflect.has(target, prop)
        return Reflect.has(target, prop) || prop in target.#attributes || prop in target.#relations
      },
      ownKeys: (target) => {
        const keys = new Set<string | symbol>(Reflect.ownKeys(target))
        for (const k of Object.keys(target.#attributes)) keys.add(k)
        for (const k of Object.keys(target.#relations)) keys.add(k)
        return Array.from(keys)
      },
      getOwnPropertyDescriptor: (target, prop) => {
        if (typeof prop === 'symbol') return Reflect.getOwnPropertyDescriptor(target, prop)
        const desc = Reflect.getOwnPropertyDescriptor(target, prop)
        if (desc) return desc
        if (prop in target.#attributes) {
          return { enumerable: true, configurable: true }
        }
        return undefined
      },
    }
  }

  static #wrapWithAttributeProxy<T extends Model>(instance: T): T {
    return new Proxy(instance, Model.#attributeProxyHandler()) as T
  }

  /**
   * Create a new model instance.
   *
   * The constructor wraps the instance in a Proxy so `model.email` maps to attributes.
   */
  public constructor() {
    if (Model.#hydrateDepth > 0) {
      return this
    }
    return Model.#wrapWithAttributeProxy(this as Model) as this
  }

  // -----------------------------
  // Static query helpers
  // -----------------------------

  /**
   * Create a fresh query builder scoped to this model (applies global scopes, hydration, local scopes).
   */
  public static query<T extends Model>(this: ModelClass<T>): QueryBuilder<T> {
    ensureTable(this)
    ensureBooted(this)

    const base = db(this.table)
    const scoped = this.applyGlobalScopes(base)
    const hydrated = this.hydrateQuery<T>(scoped)
    return this.applyLocalScopeProxy<T>(hydrated)
  }

  /**
   * Escape hatch: build complex queries starting from the model table.
   */
  public static where<T extends Model>(
    this: ModelClass<T>,
    column: string,
    operator: string,
    value: unknown,
  ): QueryBuilder<T>
  public static where<T extends Model>(
    this: ModelClass<T>,
    column: string,
    value: unknown,
  ): QueryBuilder<T>
  public static where<T extends Model>(
    this: ModelClass<T>,
    callback: (qb: QueryBuilder<T>) => void,
  ): QueryBuilder<T>
  public static where<T extends Model>(
    this: ModelClass<T>,
    a: string | ((qb: QueryBuilder<T>) => void),
    b?: string | unknown,
    c?: unknown,
  ): QueryBuilder<T> {
    const qb = this.query<T>()
    if (typeof a === 'function')
      return qb.where((inner: QueryBuilder) => {
        a(inner as QueryBuilder<T>)
      })
    if (typeof b === 'string' && arguments.length === 3) return qb.where(a, b, c)
    return qb.where(a, b)
  }

  public static whereIn<T extends Model>(
    this: ModelClass<T>,
    column: string,
    values: unknown[],
  ): QueryBuilder<T> {
    return this.query<T>().whereIn(column, values)
  }

  public static orderBy<T extends Model>(
    this: ModelClass<T>,
    column: string,
    direction: 'asc' | 'desc' = 'asc',
  ): QueryBuilder<T> {
    return this.query<T>().orderBy(column, direction)
  }

  public static limit<T extends Model>(this: ModelClass<T>, n: number): QueryBuilder<T> {
    return this.query<T>().limit(n)
  }

  /**
   * Fetch all records.
   */
  public static async all<T extends Model>(this: ModelClass<T>): Promise<T[]> {
    return await this.query<T>().get<T>()
  }

  /**
   * Length-aware pagination for this model's table.
   */
  public static async paginate<T extends Model>(
    this: ModelClass<T>,
    perPage?: number,
    options?: PaginationOptions,
  ): Promise<LengthAwarePaginator<T>> {
    return await this.query<T>().paginate<T>(perPage, options)
  }

  /**
   * Simple pagination (no total count) for this model's table.
   */
  public static async simplePaginate<T extends Model>(
    this: ModelClass<T>,
    perPage?: number,
    options?: PaginationOptions,
  ): Promise<Paginator<T>> {
    return await this.query<T>().simplePaginate<T>(perPage, options)
  }

  /**
   * Cursor pagination; uses {@link Model.primaryKey} when no `orderBy` is set on the query.
   */
  public static async cursorPaginate<T extends Model>(
    this: ModelClass<T>,
    perPage?: number,
    options?: CursorPaginationOptions,
  ): Promise<CursorPaginator<T>> {
    const pk = this.primaryKey
    return await this.query<T>().cursorPaginate<T>(perPage, { ...options, primaryKeyColumn: pk })
  }

  /**
   * Find by primary key.
   */
  public static async find<T extends Model>(
    this: ModelClass<T>,
    id: number | string,
  ): Promise<T | null> {
    const pk = this.primaryKey
    return await this.where<T>(pk, id).first<T>()
  }

  /**
   * Find by primary key or throw.
   */
  public static async findOrFail<T extends Model>(
    this: ModelClass<T>,
    id: number | string,
  ): Promise<T> {
    const found = await this.find<T>(id)
    if (!found) throw new ModelNotFoundException(this.name, id)
    return found
  }

  /**
   * Find many by primary key; preserves input order.
   */
  public static async findMany<T extends Model>(
    this: ModelClass<T>,
    ids: (number | string)[],
  ): Promise<T[]> {
    const pk = this.primaryKey
    if (ids.length === 0) return []
    const rows = await this.whereIn<T>(pk, ids as unknown[]).get<T>()
    const map = new Map<string, T>()
    for (const m of rows) {
      const key = String((m as unknown as Model).getAttribute(pk))
      map.set(key, m)
    }
    return ids.map((id) => map.get(String(id))).filter((m): m is T => m !== undefined)
  }

  /**
   * Return the first row ordered by primary key asc.
   */
  public static async first<T extends Model>(this: ModelClass<T>): Promise<T | null> {
    const pk = this.primaryKey
    return await this.query<T>().orderBy(pk, 'asc').first<T>()
  }

  /**
   * Return the first row or throw.
   */
  public static async firstOrFail<T extends Model>(this: ModelClass<T>): Promise<T> {
    const row = await this.first<T>()
    if (!row) throw new ModelNotFoundException(this.name, 'first')
    return row
  }

  /**
   * Create and persist a model with mass assignment rules and hooks.
   */
  public static async create<T extends Model>(this: ModelClass<T>, data: Partial<T>): Promise<T> {
    const model = new (this as unknown as new () => T)()
    model.fill(data)
    await model.save()
    return model
  }

  /**
   * First or create atomically (returns [model, wasCreated]).
   */
  public static async firstOrCreate<T extends Model>(
    this: ModelClass<T>,
    search: Partial<T>,
    data: Partial<T> = {},
  ): Promise<[T, boolean]> {
    const pk = this.primaryKey
    const builder = this.query<T>()
    return await builder.transaction(async (trx) => {
      // Lock any matching row to prevent race.
      let q = trx
      for (const [k, v] of Object.entries(search as Record<string, unknown>)) q = q.where(k, v)
      const found = await q.lockForUpdate().first<T>()
      if (found) return [found, false]

      const merged = {
        ...(search as Record<string, unknown>),
        ...(data as Record<string, unknown>),
      }
      const m = new (this as unknown as new () => T)()
      m.fill(merged as Partial<T>)
      await (m as unknown as Model)._saveWithBuilder(q.table(this.table))
      const id = m.getAttribute(pk)
      const hydrated = id !== undefined && id !== null ? await trx.where(pk, id).first<T>() : null
      return [hydrated ?? m, true]
    })
  }

  /**
   * First or new (does not persist).
   */
  public static async firstOrNew<T extends Model>(
    this: ModelClass<T>,
    search: Partial<T>,
    data: Partial<T> = {},
  ): Promise<T> {
    let q = this.query<T>()
    for (const [k, v] of Object.entries(search as Record<string, unknown>)) q = q.where(k, v)
    const found = await q.first<T>()
    if (found) return found
    const m = new (this as unknown as new () => T)()
    m.fill({
      ...(search as Record<string, unknown>),
      ...(data as Record<string, unknown>),
    } as Partial<T>)
    return m
  }

  /**
   * Update or create atomically.
   */
  public static async updateOrCreate<T extends Model>(
    this: ModelClass<T>,
    search: Partial<T>,
    data: Partial<T>,
  ): Promise<T> {
    const pk = this.primaryKey
    const builder = this.query<T>()
    return await builder.transaction(async (trx) => {
      let q = trx
      for (const [k, v] of Object.entries(search as Record<string, unknown>)) q = q.where(k, v)
      const found = await q.lockForUpdate().first<T>()
      if (!found) {
        const created = await this.create<T>({
          ...(search as Record<string, unknown>),
          ...(data as Record<string, unknown>),
        } as Partial<T>)
        return created
      }
      const model = found as unknown as Model
      model.fill(data as Partial<Model>)
      await model._saveWithBuilder(q.table(this.table))
      const id = model.getAttribute(pk)
      const refreshed = id !== null && id !== undefined ? await trx.where(pk, id).first<T>() : null
      return refreshed ?? (model as T)
    })
  }

  /**
   * Bulk insert (no hydration, no hooks, no mass-assignment).
   */
  public static async insert(rows: Record<string, unknown>[]): Promise<void> {
    ensureTable(this)
    if (rows.length === 0) return
    await db(this.table).insert(rows)
  }

  /**
   * Truncate table (blocked in production unless ALLOW_UNSAFE_OPERATIONS=true).
   */
  public static async truncate(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNSAFE_OPERATIONS !== 'true') {
      throw new DangerousOperationException()
    }
    ensureTable(this)
    await db(this.table).truncate()
  }

  // Aggregates
  public static async count(column?: string): Promise<number> {
    ensureTable(this)
    return await db(this.table).count(column ?? '*')
  }
  public static async max(column: string): Promise<number> {
    ensureTable(this)
    return await db(this.table).max(column)
  }
  public static async min(column: string): Promise<number> {
    ensureTable(this)
    return await db(this.table).min(column)
  }
  public static async avg(column: string): Promise<number> {
    ensureTable(this)
    return await db(this.table).avg(column)
  }
  public static async sum(column: string): Promise<number> {
    ensureTable(this)
    return await db(this.table).sum(column)
  }
  public static async exists<T extends Model>(
    this: ModelClass<T>,
    id: number | string,
  ): Promise<boolean> {
    const pk = this.primaryKey
    return (await this.where(pk, id).exists()) as unknown as boolean
  }

  // Eager loading
  public static with<T extends Model>(
    this: ModelClass<T>,
    ...relations: string[]
  ): QueryBuilder<T> {
    const qb = this.query<T>()
    return qb._afterFetch(async (rows) => {
      await this.eagerLoad(rows as unknown as Model[], relations)
    })
  }

  public static withCount<T extends Model>(
    this: ModelClass<T>,
    ...relations: string[]
  ): QueryBuilder<T> {
    // Simple, portable strategy: run additional batched count queries per relation and append `{relation}_count`.
    const qb = this.query<T>()
    return qb._afterFetch(async (rows) => {
      await this.eagerLoadCount(rows as unknown as Model[], relations)
    })
  }

  // Global scopes
  public static addGlobalScope(name: string, scope: Scope): void {
    const map = getGlobalScopes(this)
    map.set(name, scope)
  }

  public static withoutGlobalScope<T extends Model>(
    this: ModelClass<T>,
    name: string,
  ): QueryBuilder<T> {
    return this.queryWithoutScopes<T>(new Set([name]))
  }

  public static withoutGlobalScopes<T extends Model>(this: ModelClass<T>): QueryBuilder<T> {
    return this.queryWithoutScopes<T>(new Set(['*']))
  }

  /**
   * Boot hook for registering global scopes. Called once per model class.
   */
  public static booted(): void {}

  /**
   * Register an observer instance.
   */
  public static observe(observer: object): void {
    getObservers(this).push(observer)
  }

  // -----------------------------
  // Instance persistence
  // -----------------------------

  /**
   * Persist this model (insert or update).
   */
  public async save(): Promise<void> {
    await this.#saveInternal()
  }

  /**
   * @internal Save using an existing transaction-scoped builder.
   */
  public async _saveWithBuilder(builder: QueryBuilder): Promise<void> {
    await this.#saveInternal(builder)
  }

  async #saveInternal(builder?: QueryBuilder): Promise<void> {
    const ctor = this.constructor as typeof Model
    ensureTable(ctor)
    ensureBooted(ctor)

    const pk = ctor.primaryKey
    const timestamps = ctor.timestamps

    const now = new Date()
    if (timestamps) {
      if (!this.#exists && this.getAttribute('created_at') === undefined)
        this.setAttribute('created_at', now)
      this.setAttribute('updated_at', now)
    }

    await ctor.callHook('saving', this)

    if (!this.#exists) {
      const attributes = { ...this.#attributes }
      await ctor.callHook('creating', attributes)

      const run = async (trx: QueryBuilder) => {
        // Insert
        if (ctor.incrementing) {
          const id = await trx.table(ctor.table).insertGetId(attributes)
          this.setAttribute(pk, id)
        } else {
          const id = this.getAttribute(pk)
          if (id === undefined || id === null) {
            throw new Error(
              `Model [${ctor.name}] is not incrementing but primary key [${pk}] is missing. Set it before calling save().`,
            )
          }
          await trx.table(ctor.table).insert(attributes)
        }
      }

      await (builder
        ? run(builder)
        : (ctor as unknown as ModelClass<Model>).query().transaction(run))

      this.#exists = true
      this.syncOriginal()
      this.#lastChanges = { ...this.#attributes }

      await ctor.callHook('created', this)
      await ctor.callHook('saved', this)
      return
    }

    const dirty = this.getDirty()
    if (Object.keys(dirty).length === 0) {
      this.#lastChanges = {}
      return
    }

    await ctor.callHook('updating', this)

    const id = this.getAttribute(pk)
    if (id === undefined || id === null) {
      throw new Error(`Model [${ctor.name}] cannot be updated without a primary key value [${pk}].`)
    }

    const affected = builder
      ? await builder.table(ctor.table).where(pk, id).update(dirty)
      : await (ctor as unknown as ModelClass<Model>).query().where(pk, id).update(dirty)
    if (affected > 0) {
      this.#lastChanges = { ...dirty }
      this.syncOriginal()
    }

    await ctor.callHook('updated', this)
    await ctor.callHook('saved', this)
  }

  /**
   * Delete this model.
   */
  public async delete(): Promise<void> {
    if (!this.#exists) throw new ModelNotPersistedException()
    const ctor = this.constructor as typeof Model
    ensureTable(ctor)
    ensureBooted(ctor)
    const pk = ctor.primaryKey
    const id = this.getAttribute(pk)
    if (id === undefined || id === null) throw new ModelNotPersistedException()

    await ctor.callHook('deleting', this)
    await (ctor as unknown as ModelClass<Model>).query().where(pk, id).delete()
    this.#exists = false
    await ctor.callHook('deleted', this)
  }

  /**
   * Force delete (soft delete mixin overrides this).
   */
  public async forceDelete(): Promise<void> {
    await this.delete()
  }

  /**
   * Restore (soft delete mixin overrides this).
   */
  public async restore(): Promise<void> {
    throw new Error(`Model [${(this.constructor as typeof Model).name}] does not use soft deletes.`)
  }

  // -----------------------------
  // Instance data access
  // -----------------------------

  public exists(): boolean {
    return this.#exists
  }

  /**
   * Mass-assign attributes respecting fillable/guarded rules.
   */
  public fill(data: Partial<this>): this {
    const ctor = this.constructor as typeof Model
    const modelName = ctor.name
    const fillable = ctor.fillable
    const guarded = ctor.guarded

    const entries = Object.entries(data as Record<string, unknown>)
    for (const [key, value] of entries) {
      if (fillable.length > 0) {
        if (!fillable.includes(key)) continue
        this.setAttribute(key, value)
        continue
      }

      if (guarded.length > 0) {
        if (guarded.includes(key)) {
          if (fillable.length === 0 && guarded.length === 0) {
            throw new MassAssignmentException(modelName, key)
          }
          throw new MassAssignmentException(modelName, key)
        }
        this.setAttribute(key, value)
        continue
      }

      // Unguarded mode (no fillable/guarded configured) — forbid assigning unknown keys.
      throw new MassAssignmentException(modelName, key)
    }
    return this
  }

  /**
   * Force fill bypasses mass-assignment. Never use with raw user input.
   */
  public forceFill(data: Partial<this>): this {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      this.setAttribute(key, value)
    }
    return this
  }

  /**
   * Get an attribute value, applying accessors when available.
   */
  public getAttribute(key: string): unknown {
    const accessor = `get${pascalCase(key)}Attribute`
    const fn = (this as unknown as Record<string, unknown>)[accessor]
    if (typeof fn === 'function') {
      return (fn as () => unknown).call(this)
    }
    return this.#attributes[key]
  }

  /**
   * Set an attribute value, applying mutators when available.
   */
  public setAttribute(key: string, value: unknown): void {
    const mutator = `set${pascalCase(key)}Attribute`
    const fn = (this as unknown as Record<string, unknown>)[mutator]
    if (typeof fn === 'function') {
      ;(fn as (v: unknown) => void).call(this, value)
      return
    }
    this.#attributes[key] = value
  }

  public getAttributes(): Attributes {
    return { ...this.#attributes }
  }

  public getDirty(): Attributes {
    const dirty: Attributes = {}
    for (const [k, v] of Object.entries(this.#attributes)) {
      const orig = this.#original[k]
      if (!deepEqual(v, orig)) dirty[k] = v
    }
    return dirty
  }

  public isDirty(key?: string): boolean {
    const dirty = this.getDirty()
    if (!key) return Object.keys(dirty).length > 0
    return key in dirty
  }

  public isClean(key?: string): boolean {
    return !this.isDirty(key)
  }

  public wasChanged(key?: string): boolean {
    if (!key) return Object.keys(this.#lastChanges).length > 0
    return key in this.#lastChanges
  }

  /**
   * Re-fetch this record as a new instance.
   */
  public async fresh(): Promise<this> {
    const ctor = this.constructor as typeof Model
    const pk = ctor.primaryKey
    const id = this.getAttribute(pk)
    if (id === undefined || id === null) throw new ModelNotPersistedException()
    const fresh = await (ctor as unknown as ModelClass<Model>)
      .query<Model>()
      .where(pk, id)
      .first<Model>()
    if (!fresh) throw new ModelNotFoundException(ctor.name, id as number | string)
    return fresh as this
  }

  /**
   * Refresh this instance in-place.
   */
  public async refresh(): Promise<void> {
    const fresh = await this.fresh()
    this.#attributes = (fresh as unknown as Model).getAttributes()
    this.syncOriginal()
    this.#exists = true
  }

  // -----------------------------
  // Serialization
  // -----------------------------

  public toObject(): Attributes {
    const ctor = this.constructor as typeof Model
    const hidden = ctor.hidden ?? []
    const out: Attributes = {}
    for (const [k, v] of Object.entries(this.#attributes)) {
      if (hidden.includes(k)) continue
      out[k] = v
    }
    return out
  }

  public toJSON(): Record<string, unknown> {
    const ctor = this.constructor as typeof Model
    const base = this.toObject()

    const appends = ctor.appends ?? []
    for (const key of appends) {
      base[key] = this.getAttribute(key)
    }

    for (const [k, v] of Object.entries(this.#relations)) {
      base[k] = v
    }
    return base
  }

  public toString(): string {
    return JSON.stringify(this.toJSON(), null, 2)
  }

  // -----------------------------
  // Utilities
  // -----------------------------

  public is(other: Model): boolean {
    const a = this.constructor as typeof Model
    const b = other.constructor as typeof Model
    if (a.table !== b.table) return false
    const pk = a.primaryKey
    return this.getAttribute(pk) === other.getAttribute(pk)
  }

  public isNot(other: Model): boolean {
    return !this.is(other)
  }

  public clone(): this {
    const ctor = this.constructor as new () => this
    const copy = new ctor()
    const pk = (this.constructor as typeof Model).primaryKey
    const attrs = { ...this.#attributes }
    delete attrs[pk]
    copy.forceFill(attrs as Partial<this>)
    copy.#exists = false
    copy.syncOriginal()
    return copy
  }

  // -----------------------------
  // Relationships (instance)
  // -----------------------------

  protected hasOne<T extends Model>(
    RelatedModel: ModelConstructor<T>,
    foreignKey?: string,
    localKey?: string,
  ): RelationBuilder<T> {
    const parentCtor = this.constructor as typeof Model
    const relatedCtor = RelatedModel as unknown as typeof Model
    const fk = foreignKey ?? `${toSnakeCase(parentCtor.name)}_id`
    const lk = localKey ?? parentCtor.primaryKey
    const localValue = this.getAttribute(lk)
    if (localValue === undefined || localValue === null) throw new ModelNotPersistedException()

    const q = (RelatedModel as unknown as ModelClass<T>).query<T>().where(fk, localValue)
    return new RelationBuilder<T>(q, {
      type: 'hasOne',
      name: '',
      parent: this,
      related: relatedCtor,
      foreignKey: fk,
      localKey: lk,
    })
  }

  protected hasMany<T extends Model>(
    RelatedModel: ModelConstructor<T>,
    foreignKey?: string,
    localKey?: string,
  ): RelationBuilder<T> {
    const parentCtor = this.constructor as typeof Model
    const relatedCtor = RelatedModel as unknown as typeof Model
    const fk = foreignKey ?? `${toSnakeCase(parentCtor.name)}_id`
    const lk = localKey ?? parentCtor.primaryKey
    const localValue = this.getAttribute(lk)
    if (localValue === undefined || localValue === null) throw new ModelNotPersistedException()

    const q = (RelatedModel as unknown as ModelClass<T>).query<T>().where(fk, localValue)
    return new RelationBuilder<T>(q, {
      type: 'hasMany',
      name: '',
      parent: this,
      related: relatedCtor,
      foreignKey: fk,
      localKey: lk,
    })
  }

  protected belongsTo<T extends Model>(
    RelatedModel: ModelConstructor<T>,
    foreignKey?: string,
    ownerKey?: string,
  ): RelationBuilder<T> {
    const relatedCtor = RelatedModel as unknown as typeof Model
    const fk = foreignKey ?? `${toSnakeCase(relatedCtor.name)}_id`
    const ok = ownerKey ?? relatedCtor.primaryKey
    const fkValue = this.getAttribute(fk)
    const q = (RelatedModel as unknown as ModelClass<T>).query<T>()
    if (fkValue !== undefined && fkValue !== null) q.where(ok, fkValue)
    return new RelationBuilder<T>(q, {
      type: 'belongsTo',
      name: '',
      parent: this,
      related: relatedCtor,
      foreignKey: fk,
      ownerKey: ok,
    })
  }

  protected belongsToMany<T extends Model>(
    RelatedModel: ModelConstructor<T>,
    pivotTable?: string,
    foreignKey?: string,
    relatedKey?: string,
  ): ManyToManyRelationBuilder<T> {
    const parentCtor = this.constructor as typeof Model
    const relatedCtor = RelatedModel as unknown as typeof Model
    const parentTable = parentCtor.table
    const relatedTable = relatedCtor.table
    const pivot =
      pivotTable ??
      [parentTable, relatedTable]
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .join('_')

    const fk = foreignKey ?? `${toSnakeCase(parentCtor.name)}_id`
    const rk = relatedKey ?? `${toSnakeCase(relatedCtor.name)}_id`

    const parentId = this.getAttribute(parentCtor.primaryKey)
    if (parentId === undefined || parentId === null) throw new ModelNotPersistedException()

    const q = (RelatedModel as unknown as ModelClass<T>)
      .query<T>()
      .join(pivot, `${pivot}.${rk}`, '=', `${relatedTable}.${relatedCtor.primaryKey}`)
      .where(`${pivot}.${fk}`, parentId)

    const meta = {
      type: 'belongsToMany' as const,
      name: '',
      parent: this,
      related: relatedCtor,
      pivotTable: pivot,
      pivotForeignKey: fk,
      pivotRelatedKey: rk,
    }

    return new ManyToManyRelationBuilder<T>(q, meta)
  }

  protected hasManyThrough<T extends Model>(
    FinalModel: ModelConstructor<T>,
    ThroughModel: ModelConstructor<Model>,
    firstKey: string,
    secondKey: string,
  ): RelationBuilder<T> {
    const parentCtor = this.constructor as typeof Model
    const throughCtor = ThroughModel as unknown as typeof Model
    const finalCtor = FinalModel as unknown as typeof Model

    const parentId = this.getAttribute(parentCtor.primaryKey)
    if (parentId === undefined || parentId === null) throw new ModelNotPersistedException()

    const q = (FinalModel as unknown as ModelClass<T>)
      .query<T>()
      .join(
        throughCtor.table,
        `${throughCtor.table}.${secondKey}`,
        '=',
        `${finalCtor.table}.${finalCtor.primaryKey}`,
      )
      .where(`${throughCtor.table}.${firstKey}`, parentId)

    return new RelationBuilder<T>(q, {
      type: 'hasManyThrough',
      name: '',
      parent: this,
      related: finalCtor,
      foreignKey: firstKey,
      localKey: secondKey,
    })
  }

  protected hasOneThrough<T extends Model>(
    FinalModel: ModelConstructor<T>,
    ThroughModel: ModelConstructor<Model>,
    firstKey: string,
    secondKey: string,
  ): RelationBuilder<T> {
    return this.hasManyThrough(FinalModel, ThroughModel, firstKey, secondKey)
  }

  // -----------------------------
  // Relation cache utilities
  // -----------------------------

  public setRelation(name: string, value: unknown): void {
    this.#relations[name] = value
  }

  public getRelation<T = unknown>(name: string): T {
    if (!(name in this.#relations)) {
      throw new RelationNotLoadedException((this.constructor as typeof Model).name, name)
    }
    return this.#relations[name] as T
  }

  // -----------------------------
  // Internals: hydration/scopes/hooks
  // -----------------------------

  private syncOriginal(): void {
    this.#original = { ...this.#attributes }
  }

  /** @internal */
  public static applyGlobalScopes<T>(
    this: typeof Model,
    qb: QueryBuilder<T>,
    disabled?: Set<string>,
  ): QueryBuilder<T> {
    const scopes = getGlobalScopes(this)
    for (const [name, scope] of scopes.entries()) {
      if (disabled?.has('*') || disabled?.has(name)) continue
      scope.apply(qb as unknown as QueryBuilder, this)
    }
    return qb
  }

  /** @internal */
  public static queryWithoutScopes<T extends Model>(
    this: typeof Model,
    disabled: Set<string>,
  ): QueryBuilder<T> {
    ensureTable(this)
    ensureBooted(this)
    const base = db(this.table)
    const scoped = this.applyGlobalScopes(base, disabled)
    const hydrated = this.hydrateQuery<T>(scoped)
    return this.applyLocalScopeProxy<T>(hydrated)
  }

  /** @internal */
  public static hydrateQuery<T extends Model>(
    this: typeof Model,
    qb: QueryBuilder,
  ): QueryBuilder<T> {
    return qb._mapRow((row) => this.hydrate<T>(row as Attributes))
  }

  /**
   * Copy driver row values onto a plain attribute map (avoids prototype / non-enumerable surprises).
   */
  static #normalizeRow(row: Attributes): Attributes {
    if (row === null || typeof row !== 'object') {
      return {}
    }
    const out: Attributes = {}
    for (const key of Object.keys(row)) {
      out[key] = row[key]
    }
    return out
  }

  /** @internal */
  public static hydrate<T extends Model>(this: typeof Model, attrs: Attributes): T {
    Model.#hydrateDepth++
    try {
      const raw = new (this as unknown as new () => Model)()
      raw.#attributes = Model.#normalizeRow(attrs)
      raw.#exists = true
      raw.syncOriginal()
      return Model.#wrapWithAttributeProxy(raw as T)
    } finally {
      Model.#hydrateDepth--
    }
  }

  /** @internal */
  public static applyLocalScopeProxy<T extends Model>(
    this: typeof Model,
    qb: QueryBuilder<T>,
  ): QueryBuilder<T> {
    const model = this
    const handler: ProxyHandler<QueryBuilder<T>> = {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
        const existing = (target as unknown as Record<string, unknown>)[prop]
        if (existing !== undefined) return existing

        const scopeMethod = `scope${pascalCase(prop)}`
        const scopeFn = (model.prototype as unknown as Record<string, unknown>)[scopeMethod]
        if (typeof scopeFn === 'function') {
          return (...args: unknown[]) => {
            const res = (
              scopeFn as (builder: QueryBuilder<T>, ...a: unknown[]) => QueryBuilder<T>
            ).call(new (model as unknown as new () => Model)(), target, ...args)
            return new Proxy(res, handler)
          }
        }
        return undefined
      },
    }
    return new Proxy(qb, handler)
  }

  private static async callHook(this: typeof Model, name: HookName, arg: unknown): Promise<void> {
    const handlers: HookHandler[] = []

    const maybe = (this as unknown as Record<string, unknown>)[name]
    if (typeof maybe === 'function') handlers.push(maybe as HookHandler)

    for (const obs of getObservers(this)) {
      const fn = (obs as Record<string, unknown>)[name]
      if (typeof fn === 'function') handlers.push(fn as HookHandler)
    }

    for (const handler of handlers) {
      await handler.call(this, arg)
    }
  }

  /** @internal for SoftDeletes */
  public static async callRestoringHook(model: Model): Promise<void> {
    await this.callHook('restoring', model)
  }
  /** @internal for SoftDeletes */
  public static async callRestoredHook(model: Model): Promise<void> {
    await this.callHook('restored', model)
  }

  private static async eagerLoad(
    this: typeof Model,
    models: Model[],
    relations: string[],
  ): Promise<void> {
    if (models.length === 0 || relations.length === 0) return

    // Group by top-level relation, keep nested.
    const groups = new Map<string, string[]>()
    for (const rel of relations) {
      const segments = rel.split('.')
      const head = segments[0]
      if (head === undefined) continue
      const rest = segments.slice(1).join('.')
      const list = groups.get(head) ?? []
      if (rest.length > 0) list.push(rest)
      groups.set(head, list)
    }

    for (const [relationName, nested] of groups.entries()) {
      // Build relation builder from the first model (assume consistent).
      const method = (models[0] as unknown as Record<string, unknown>)[relationName]
      if (typeof method !== 'function') {
        throw new Error(`Relation [${relationName}] is not defined on model [${this.name}].`)
      }

      const relBuilder = (method as () => RelationBuilder<Model>).call(models[0])
      const meta = relBuilder.getMeta()
      meta.name = relationName

      await this.eagerLoadRelation(models, relationName, relBuilder)

      // Nested eager loading
      if (nested.length > 0) {
        const relatedModels: Model[] = []
        for (const m of models) {
          const v = (m as unknown as Record<string, unknown>)[relationName]
          if (Array.isArray(v)) relatedModels.push(...(v as Model[]))
          else if (v instanceof Model) relatedModels.push(v)
        }
        if (relatedModels.length > 0) {
          const relatedCtor = meta.related
          await relatedCtor.eagerLoad(relatedModels, nested)
        }
      }
    }
  }

  private static async eagerLoadRelation(
    this: typeof Model,
    parents: Model[],
    relationName: string,
    relBuilder: RelationBuilder<Model>,
  ): Promise<void> {
    const meta = relBuilder.getMeta()
    if (meta.type === 'hasOne' || meta.type === 'hasMany') {
      const fk = meta.foreignKey!
      const lk = meta.localKey!
      const parentKeys = parents
        .map((p) => p.getAttribute(lk))
        .filter((v): v is number | string => typeof v === 'number' || typeof v === 'string')
      if (parentKeys.length === 0) {
        for (const p of parents) p.setRelation(relationName, meta.type === 'hasMany' ? [] : null)
        return
      }

      const relatedCtor = meta.related
      const related = await (relatedCtor as unknown as ModelClass<Model>)
        .query<Model>()
        .whereIn(fk, parentKeys)
        .get<Model>()
      const bucket = new Map<string, Model[]>()
      for (const r of related) {
        const key = String(r.getAttribute(fk))
        const list = bucket.get(key) ?? []
        list.push(r)
        bucket.set(key, list)
      }
      for (const p of parents) {
        const key = String(p.getAttribute(lk))
        const items = bucket.get(key) ?? []
        p.setRelation(relationName, meta.type === 'hasMany' ? items : (items[0] ?? null))
      }
      return
    }

    if (meta.type === 'belongsTo') {
      const fk = meta.foreignKey!
      const ok = meta.ownerKey!
      const fkValues = parents
        .map((p) => p.getAttribute(fk))
        .filter((v): v is number | string => typeof v === 'number' || typeof v === 'string')
      if (fkValues.length === 0) {
        for (const p of parents) p.setRelation(relationName, null)
        return
      }
      const relatedCtor = meta.related
      const related = await (relatedCtor as unknown as ModelClass<Model>)
        .query<Model>()
        .whereIn(ok, fkValues)
        .get<Model>()
      const map = new Map<string, Model>()
      for (const r of related) map.set(String(r.getAttribute(ok)), r)
      for (const p of parents) {
        const key = p.getAttribute(fk)
        p.setRelation(
          relationName,
          key === undefined || key === null ? null : (map.get(String(key)) ?? null),
        )
      }
      return
    }

    if (meta.type === 'belongsToMany') {
      // Minimal eager: fetch related via pivot in one query, then bucket by parent id using pivot columns.
      const pivot = meta.pivotTable!
      const fk = meta.pivotForeignKey!
      const rk = meta.pivotRelatedKey!

      const firstParent = parents[0]
      if (firstParent === undefined) return
      const parentPk = (firstParent.constructor as typeof Model).primaryKey
      const parentIds = parents
        .map((p) => p.getAttribute(parentPk))
        .filter((v): v is number | string => typeof v === 'number' || typeof v === 'string')
      if (parentIds.length === 0) {
        for (const p of parents) p.setRelation(relationName, [])
        return
      }

      const relatedCtor = meta.related
      const relatedTable = relatedCtor.table
      const relatedPk = relatedCtor.primaryKey

      const rows = await db(relatedTable)
        .join(pivot, `${pivot}.${rk}`, '=', `${relatedTable}.${relatedPk}`)
        .whereIn(`${pivot}.${fk}`, parentIds)
        .select(`${relatedTable}.*`, `${pivot}.${fk} as __pivot_parent_id`)
        .get<Record<string, unknown>>()

      const bucket = new Map<string, Model[]>()
      for (const row of rows) {
        const pid = row.__pivot_parent_id
        const model = relatedCtor.hydrate<Model>(row)
        const key = String(pid)
        const list = bucket.get(key) ?? []
        list.push(model)
        bucket.set(key, list)
      }
      for (const p of parents) {
        const id = p.getAttribute(parentPk)
        p.setRelation(
          relationName,
          id === undefined || id === null ? [] : (bucket.get(String(id)) ?? []),
        )
      }
    }
  }

  private static async eagerLoadCount(
    this: typeof Model,
    models: Model[],
    relations: string[],
  ): Promise<void> {
    if (models.length === 0 || relations.length === 0) return
    const pk = this.primaryKey
    const parentIds = models
      .map((m) => m.getAttribute(pk))
      .filter((v): v is number | string => typeof v === 'number' || typeof v === 'string')
    if (parentIds.length === 0) return

    for (const relationName of relations) {
      const method = (models[0] as unknown as Record<string, unknown>)[relationName]
      if (typeof method !== 'function') {
        throw new Error(`Relation [${relationName}] is not defined on model [${this.name}].`)
      }
      const relBuilder = (method as () => RelationBuilder<Model>).call(models[0])
      const meta = relBuilder.getMeta()

      if (meta.type !== 'hasMany' && meta.type !== 'hasOne') continue
      const fk = meta.foreignKey!
      const relatedCtor = meta.related

      const counts = await db(relatedCtor.table)
        .select(`${fk} as __fk`, db().raw('COUNT(*) as __count'))
        .whereIn(fk, parentIds)
        .groupBy(fk)
        .get<Record<string, unknown>>()

      const map = new Map<string, number>()
      for (const r of counts) map.set(String(r.__fk), Number(r.__count))

      for (const m of models) {
        const id = m.getAttribute(pk)
        const count = id === undefined || id === null ? 0 : (map.get(String(id)) ?? 0)
        m.setAttribute(`${relationName}_count`, count)
      }
    }
  }
}
