/**
 * @module @atlex/orm
 *
 * Public entrypoint for Atlex ORM & query layer.
 */

export { Connection } from './Connection.js'
export type { DatabaseConfig } from './Connection.js'
export { ConnectionRegistry } from './ConnectionRegistry.js'

export { QueryBuilder } from './QueryBuilder.js'
export { db } from './db.js'

export { Seeder } from './Seeder.js'

export { Model } from './Model.js'
export { serializeForHttp } from './serializeForHttp.js'
export { SoftDeletes } from './mixins/SoftDeletes.js'

export { RelationBuilder } from './relations/RelationBuilder.js'
export { ManyToManyRelationBuilder } from './relations/ManyToManyRelationBuilder.js'

export { Schema } from './migrations/Schema.js'
export { Blueprint } from './migrations/Blueprint.js'
export { ColumnDefinition } from './migrations/ColumnDefinition.js'
export { MigrationRunner } from './migrations/MigrationRunner.js'
export type {
  MigrateRunResult,
  MigrationContext,
  MigrationModule,
} from './migrations/MigrationRunner.js'

export type { PaginationResult } from './types.js'
export type { ModelConstructor, PivotData, Scope } from './types.js'

export {
  AbstractPaginator,
  Cursor,
  CursorPaginator,
  LengthAwarePaginator,
  Paginator,
} from './pagination/index.js'
export type {
  CursorPaginatedResponse,
  CursorPaginationOptions,
  PaginatedResponse,
  PaginationOptions,
  SimplePaginatedResponse,
} from './pagination/index.js'

export { InvalidCursorException } from './exceptions/InvalidCursorException.js'

export { QueryException } from './exceptions/QueryException.js'
export { NotFoundException } from './exceptions/NotFoundException.js'
export { ModelNotFoundException } from './exceptions/ModelNotFoundException.js'
export { MassAssignmentException } from './exceptions/MassAssignmentException.js'
export { ModelNotPersistedException } from './exceptions/ModelNotPersistedException.js'
export { DangerousOperationException } from './exceptions/DangerousOperationException.js'
export { RelationNotLoadedException } from './exceptions/RelationNotLoadedException.js'
