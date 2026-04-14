/**
 * MigrationRunner for `@atlex/orm`.
 *
 * Discovers migration files, tracks state in the `migrations` table (common convention), and runs
 * migrations in batches with transactional safety.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import type { Connection } from '../Connection.js'
import { ConnectionRegistry } from '../ConnectionRegistry.js'
import { DangerousOperationException } from '../exceptions/DangerousOperationException.js'

export interface MigrationContext {
  connection: Connection
}

export interface MigrationModule {
  up: (ctx: MigrationContext) => Promise<void> | void
  down: (ctx: MigrationContext) => Promise<void> | void
}

export interface MigrationStatusRow {
  migration: string
  batch: number | null
  ran: boolean
}

export interface MigrationRunnerConfig {
  migrationsPath: string
  connectionName?: string
  /** Table that stores ran migrations. @default "migrations" */
  migrationsTable?: string
}

interface MigrationRecord {
  id: number
  migration: string
  batch: number
}

export interface MigrateRunResult {
  ran: string[]
  batch: number
  /** True when the migrations table was created on this run (`migrate:install`). */
  migrationTableCreated: boolean
}

export class MigrationRunner {
  private readonly conn: Connection
  private readonly migrationsPath: string
  private readonly migrationsTable: string

  public constructor(config: MigrationRunnerConfig) {
    this.conn = ConnectionRegistry.instance().connection(config.connectionName)
    this.migrationsPath = config.migrationsPath
    const t = config.migrationsTable?.trim()
    if (t?.length === 0) {
      throw new Error('Database migrations error: "migrationsTable" must not be empty.')
    }
    this.migrationsTable = t ?? 'migrations'
  }

  /**
   * Ensure the migrations tracking table exists.
   *
   * @returns `true` if the table was created, `false` if it already existed.
   */
  public async ensureMigrationsTable(): Promise<boolean> {
    const knex = this.conn._knex()
    const table = this.migrationsTable
    const exists = await knex.schema.hasTable(table)
    if (exists) return false
    await knex.schema.createTable(table, (t) => {
      t.increments('id').primary()
      t.string('migration').notNullable().unique()
      t.integer('batch').notNullable()
    })
    return true
  }

  /**
   * Get migration status for all files discovered.
   */
  public async status(): Promise<MigrationStatusRow[]> {
    await this.ensureMigrationsTable()
    const files = await this.discoverMigrationFiles()
    const ran = await this.getRanMigrations()
    const byName = new Map<string, MigrationRecord>()
    for (const r of ran) byName.set(r.migration, r)
    return files.map((f) => {
      const rec = byName.get(f.name)
      return { migration: f.name, batch: rec?.batch ?? null, ran: rec !== undefined }
    })
  }

  /**
   * Run all pending migrations.
   */
  public async migrate(): Promise<MigrateRunResult> {
    const migrationTableCreated = await this.ensureMigrationsTable()
    const pending = await this.getPendingMigrations()
    const batch = (await this.nextBatchNumber()) ?? 1
    const ran: string[] = []

    for (const m of pending) {
      await this.runSingleMigration(m, 'up', batch)
      ran.push(m.name)
    }
    return { ran, batch, migrationTableCreated }
  }

  /**
   * Roll back the last batch.
   */
  public async rollback(): Promise<{ rolledBack: string[]; batch: number | null }> {
    await this.ensureMigrationsTable()
    const last = await this.lastBatchNumber()
    if (last === null) return { rolledBack: [], batch: null }

    const rows = await this.conn
      ._knex()<MigrationRecord>(this.migrationsTable)
      .where('batch', last)
      .orderBy('id', 'desc')

    const rolledBack: string[] = []
    for (const r of rows) {
      const file = await this.findMigrationFileByName(r.migration)
      if (!file) continue
      await this.runSingleMigration(file, 'down', last)
      rolledBack.push(r.migration)
    }
    return { rolledBack, batch: last }
  }

  /**
   * Roll back all migrations.
   */
  public async reset(): Promise<{ rolledBack: string[] }> {
    await this.ensureMigrationsTable()
    const ran = await this.getRanMigrations()
    const rolledBack: string[] = []
    for (const r of ran.sort((a, b) => b.id - a.id)) {
      const file = await this.findMigrationFileByName(r.migration)
      if (!file) continue
      await this.runSingleMigration(file, 'down', r.batch)
      rolledBack.push(r.migration)
    }
    return { rolledBack }
  }

  /**
   * Refresh migrations: reset + migrate.
   */
  public async refresh(): Promise<void> {
    await this.reset()
    await this.migrate()
  }

  /**
   * Drop all tables and re-run all migrations.
   */
  public async fresh(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNSAFE_OPERATIONS !== 'true') {
      throw new DangerousOperationException()
    }
    const knex = this.conn._knex()
    // Drop all tables (best-effort per dialect)
    const client = knex.client.config.client
    if (client === 'pg') {
      await knex.raw(
        `DO $$ DECLARE r RECORD;
        BEGIN
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
        END $$;`,
      )
    } else if (client === 'mysql2') {
      const rows = (await knex.raw('SHOW TABLES')) as unknown
      const list: string[] = extractMysqlTableNames(rows)
      if (list.length > 0) {
        await knex.raw('SET FOREIGN_KEY_CHECKS=0')
        for (const t of list) await knex.raw(`DROP TABLE IF EXISTS \`${t}\``)
        await knex.raw('SET FOREIGN_KEY_CHECKS=1')
      }
    } else {
      // sqlite / better-sqlite3
      const rows = await knex.raw(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      )
      const names = extractSqliteTableNames(rows)
      for (const t of names) await knex.schema.dropTableIfExists(t)
    }
    await this.migrate()
  }

  // -----------------------------
  // Internals
  // -----------------------------

  private async runSingleMigration(
    file: MigrationFile,
    direction: 'up' | 'down',
    batch: number,
  ): Promise<void> {
    const knex = this.conn._knex()
    const fullPath = file.fullPath
    const name = file.name

    try {
      await knex.transaction(async (trx) => {
        const mod = await this.importMigration(fullPath, name)
        const ctx: MigrationContext = { connection: this.conn }
        await Promise.resolve(mod[direction](ctx))

        await (direction === 'up'
          ? trx(this.migrationsTable).insert({ migration: name, batch })
          : trx(this.migrationsTable).where({ migration: name }).delete())
      })
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Unknown migration error')
      throw new Error(`Migration failed in [${name}]: ${err.message}`)
    }
  }

  private async importMigration(fullPath: string, name: string): Promise<MigrationModule> {
    const url = pathToFileURL(fullPath).href
    const mod = (await import(url)) as unknown
    if (!isMigrationModule(mod)) {
      throw new Error(
        `Invalid migration module "${name}". Expected named exports { up, down } with function signatures (ctx) => void|Promise<void>.`,
      )
    }
    return mod
  }

  private async nextBatchNumber(): Promise<number | null> {
    const knex = this.conn._knex()
    const rows = await knex(this.migrationsTable).max<{ max: number | string | null }>({
      max: 'batch',
    })
    const max = rows[0]?.max ?? null
    if (max === null) return 1
    const n = typeof max === 'number' ? max : Number(max)
    return Number.isFinite(n) ? n + 1 : 1
  }

  private async lastBatchNumber(): Promise<number | null> {
    const knex = this.conn._knex()
    const rows = await knex(this.migrationsTable).max<{ max: number | string | null }>({
      max: 'batch',
    })
    const max = rows[0]?.max ?? null
    if (max === null) return null
    const n = typeof max === 'number' ? max : Number(max)
    return Number.isFinite(n) ? n : null
  }

  private async getRanMigrations(): Promise<MigrationRecord[]> {
    const knex = this.conn._knex()
    return (await knex<MigrationRecord>(this.migrationsTable).orderBy(
      'id',
      'asc',
    )) as MigrationRecord[]
  }

  private async getPendingMigrations(): Promise<MigrationFile[]> {
    const files = await this.discoverMigrationFiles()
    const ran = await this.getRanMigrations()
    const ranSet = new Set(ran.map((r) => r.migration))
    return files.filter((f) => !ranSet.has(f.name))
  }

  private async findMigrationFileByName(name: string): Promise<MigrationFile | null> {
    const files = await this.discoverMigrationFiles()
    const found = files.find((f) => f.name === name)
    return found ?? null
  }

  private async discoverMigrationFiles(): Promise<MigrationFile[]> {
    const dir = path.resolve(this.migrationsPath)
    const entries = await walk(dir)
    const files = entries
      .filter((p) => p.endsWith('.ts') || p.endsWith('.js'))
      .map((p) => ({
        fullPath: p,
        name: path.basename(p),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    // Prefer .js over .ts if both exist for same base name
    const byBase = new Map<string, MigrationFile>()
    for (const f of files) {
      const base = f.name.replace(/\.(ts|js)$/i, '')
      const existing = byBase.get(base)
      if (!existing) {
        byBase.set(base, f)
        continue
      }
      if (existing.name.endsWith('.ts') && f.name.endsWith('.js')) {
        byBase.set(base, f)
      }
    }
    return Array.from(byBase.values()).sort((a, b) => a.name.localeCompare(b.name))
  }
}

interface MigrationFile {
  name: string
  fullPath: string
}

function isMigrationModule(value: unknown): value is MigrationModule {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.up === 'function' && typeof v.down === 'function'
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (e.isFile()) {
      out.push(full)
    }
  }
  return out
}

function extractMysqlTableNames(raw: unknown): string[] {
  // Knex mysql2 raw returns [rows, fields] or similar.
  if (!Array.isArray(raw) || raw.length === 0) return []
  const rows = raw[0]
  if (!Array.isArray(rows)) return []
  const names: string[] = []
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue
    const values = Object.values(r as Record<string, unknown>)
    const first = values[0]
    if (typeof first === 'string') names.push(first)
  }
  return names
}

function extractSqliteTableNames(raw: unknown): string[] {
  // better-sqlite3 returns { ... } or array depending on knex; normalize to array
  const rows = Array.isArray(raw) ? raw : (raw as { rows?: unknown[] } | null)?.rows
  if (!Array.isArray(rows)) return []
  const names: string[] = []
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue
    const name = (r as Record<string, unknown>).name
    if (typeof name === 'string') names.push(name)
  }
  return names
}
