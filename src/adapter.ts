/*
|--------------------------------------------------------------------------
| Lucid Adapter for better-auth
|--------------------------------------------------------------------------
|
| This module provides a better-auth database adapter backed by AdonisJS
| Lucid's raw query builder. It does NOT require Lucid Models — it operates
| directly on tables via the `db` service.
|
| Usage:
|   import { betterAuth } from 'better-auth'
|   import { lucidAdapter } from 'better-lucid'
|   import db from '@adonisjs/lucid/services/db'
|
|   export const auth = betterAuth({
|     database: lucidAdapter(db),
|   })
|
*/

import { createAdapterFactory } from 'better-auth/adapters'
import type { Database } from '@adonisjs/lucid/database'
import type { CleanedWhere } from 'better-auth/adapters'
import type { BetterAuthDBSchema, DBFieldAttribute } from '@better-auth/core/db'

export type LucidAdapterConfig = {
  /**
   * Enable debug logging of all adapter queries.
   * @default false
   */
  debugLogs?: boolean

  /**
   * Use plural table names (e.g. "users" instead of "user").
   * @default false
   */
  usePlural?: boolean
}

// ============================================================================
// Schema generation helpers (used by createSchema)
// ============================================================================

/** Converts a camelCase field name to snake_case for use as a DB column name. */
function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase()
}

/** Returns a `YYYYMMDDHHmmss` timestamp string for migration filenames. */
function generateTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
}

/** Returns the DB column name for a schema field, respecting the `fieldName` override. */
function getColumnName(schemaKey: string, field: DBFieldAttribute): string {
  return (field as any).fieldName ?? camelToSnake(schemaKey)
}

/** Maps a better-auth `DBFieldType` to the Lucid schema builder method name. */
function getKnexType(field: DBFieldAttribute): string {
  const type = field.type as string
  if (type === 'string') {
    return (field as any).sortable ? 'string' : 'text'
  }
  if (type === 'number') {
    return (field as any).bigint ? 'bigInteger' : 'integer'
  }
  if (type === 'boolean') return 'boolean'
  if (type === 'date') return 'timestamp'
  if (type === 'json') return 'jsonb'
  // string[] or number[] — serialised as JSON text
  return 'text'
}

const ON_DELETE_MAP: Record<string, string> = {
  'cascade': 'CASCADE',
  'set null': 'SET NULL',
  'restrict': 'RESTRICT',
  'no action': 'NO ACTION',
  'set default': 'SET DEFAULT',
}

/**
 * Builds the Lucid column chain string for a single field.
 * Does NOT include the leading `table.` — callers add that.
 *
 * @example
 *   buildColumnChain('userId', field, tables)
 *   // → "text('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE')"
 */
function buildColumnChain(
  schemaKey: string,
  field: DBFieldAttribute,
  allTables: BetterAuthDBSchema
): string {
  const colName = getColumnName(schemaKey, field)
  const knexType = getKnexType(field)

  // Base column definition
  const typeArg = knexType === 'timestamp' ? `'${colName}', { useTz: true }` : `'${colName}'`
  let chain = `${knexType}(${typeArg})`

  // Primary key (only for 'id' fields)
  if (schemaKey === 'id') {
    chain += '.primary()'
  }

  // Nullability — required defaults to true
  if ((field as any).required !== false) {
    chain += '.notNullable()'
  } else {
    chain += '.nullable()'
  }

  // Unique constraint
  if ((field as any).unique) {
    chain += '.unique()'
  }

  // Foreign key reference
  const refs = (field as any).references
  if (refs) {
    const refModelName = allTables[refs.model]?.modelName ?? refs.model
    const onDelete = ON_DELETE_MAP[refs.onDelete ?? 'cascade'] ?? 'CASCADE'
    chain += `.references('${refs.field}').inTable('${refModelName}').onDelete('${onDelete}')`
  } else if ((field as any).index) {
    // Only add .index() when there's no FK (FK already creates an index)
    chain += '.index()'
  }

  return chain
}

/**
 * Generates a `this.schema.createTable(...)` block for a single table.
 * The `id` field is always emitted first; remaining fields follow in schema order.
 */
function generateCreateTableBlock(
  modelName: string,
  fields: Record<string, DBFieldAttribute>,
  allTables: BetterAuthDBSchema,
  indent: string
): string {
  const lines: string[] = []

  // id first
  if (fields['id']) {
    lines.push(`${indent}  table.${buildColumnChain('id', fields['id'], allTables)}`)
  }

  // Remaining fields in definition order
  for (const [key, field] of Object.entries(fields)) {
    if (key === 'id') continue
    lines.push(`${indent}  table.${buildColumnChain(key, field, allTables)}`)
  }

  return `${indent}this.schema.createTable('${modelName}', (table) => {\n${lines.join('\n')}\n${indent}})`
}

/**
 * Queries `information_schema.tables` and returns the set of table names
 * that currently exist in the `public` schema.
 */
async function queryExistingTables(db: Database): Promise<Set<string>> {
  const rows = await db
    .from('information_schema.tables')
    .where('table_schema', 'public')
    .where('table_type', 'BASE TABLE')
    .select('table_name')

  return new Set(rows.map((r: any) => r.table_name as string))
}

/**
 * Queries `information_schema.columns` for the given table names and returns
 * a map of `tableName → Set<columnName>`.
 */
async function queryExistingColumns(
  db: Database,
  tableNames: string[]
): Promise<Map<string, Set<string>>> {
  if (tableNames.length === 0) return new Map()

  const rows = await db
    .from('information_schema.columns')
    .where('table_schema', 'public')
    .whereIn('table_name', tableNames)
    .select('table_name', 'column_name')

  const result = new Map<string, Set<string>>()
  for (const row of rows as Array<{ table_name: string; column_name: string }>) {
    if (!result.has(row.table_name)) result.set(row.table_name, new Set())
    result.get(row.table_name)!.add(row.column_name)
  }
  return result
}

/** Wraps up/down bodies in a Lucid BaseSchema migration class string. */
function wrapInBaseSchema(upBody: string, downBody: string): string {
  return [
    `import { BaseSchema } from '@adonisjs/lucid/schema'`,
    ``,
    `export default class extends BaseSchema {`,
    `  async up() {`,
    upBody,
    `  }`,
    ``,
    `  async down() {`,
    downBody,
    `  }`,
    `}`,
    ``,
  ].join('\n')
}

// ============================================================================
// Full migration generator (extracted for testability)
// ============================================================================

/**
 * Generates a Lucid migration file string that reflects the current better-auth
 * schema (core tables + all enabled plugins).
 *
 * Fresh DB  → full CREATE TABLE migration for every active table.
 * Existing  → incremental: ALTER TABLE ADD COLUMN / CREATE TABLE for new items;
 *             removed columns/tables are emitted as WARNING comments only.
 */
async function generateLucidMigration(
  db: Database,
  tables: BetterAuthDBSchema,
  file?: string
): Promise<{ code: string; path: string; overwrite: boolean }> {
  // 1. Filter and sort tables
  const activeTables = Object.values(tables)
    .filter((t) => !t.disableMigrations)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))

  const timestamp = generateTimestamp()
  const outputPath = file ?? `database/migrations/${timestamp}_better_auth_schema.ts`

  // 2. Detect current DB state using information_schema
  const existingTables = await queryExistingTables(db)
  const isFresh = !existingTables.has('user')

  // ── FRESH MODE ────────────────────────────────────────────────
  if (isFresh) {
    const upBlocks = activeTables.map((t) =>
      generateCreateTableBlock(t.modelName, t.fields, tables, '    ')
    )
    const downLines = [...activeTables]
      .reverse()
      .map((t) => `    this.schema.dropTableIfExists('${t.modelName}')`)

    return {
      code: wrapInBaseSchema(upBlocks.join('\n\n'), downLines.join('\n')),
      path: outputPath,
      overwrite: false,
    }
  }

  // ── INCREMENTAL MODE ──────────────────────────────────────────
  const desiredTableNames = new Set(activeTables.map((t) => t.modelName))
  const existingColumns = await queryExistingColumns(db, [...desiredTableNames])

  const upStatements: string[] = []
  const downStatements: string[] = []
  const warnings: string[] = []

  for (const table of activeTables) {
    const { modelName, fields } = table

    if (!existingTables.has(modelName)) {
      // New table from a plugin — CREATE TABLE
      upStatements.push(generateCreateTableBlock(modelName, fields, tables, '    '))
      downStatements.unshift(`    this.schema.dropTableIfExists('${modelName}')`)
      continue
    }

    // Existing table — check for new columns (ALTER TABLE ADD COLUMN)
    const currentCols = existingColumns.get(modelName) ?? new Set<string>()
    const addColLines: string[] = []

    for (const [schemaKey, field] of Object.entries(fields)) {
      if (schemaKey === 'id') continue
      const colName = getColumnName(schemaKey, field)
      if (!currentCols.has(colName)) {
        addColLines.push(`      table.${buildColumnChain(schemaKey, field, tables)}`)
      }
    }

    if (addColLines.length > 0) {
      upStatements.push(
        `    this.schema.table('${modelName}', (table) => {\n${addColLines.join('\n')}\n    })`
      )
      // Reverse: drop the freshly added columns
      const dropLines = addColLines
        .map((line) => {
          const m = line.match(/table\.\w+\('([^']+)'/)
          return m ? `      table.dropColumn('${m[1]}')` : null
        })
        .filter(Boolean) as string[]
      if (dropLines.length > 0) {
        downStatements.push(
          `    this.schema.table('${modelName}', (table) => {\n${dropLines.join('\n')}\n    })`
        )
      }
    }

    // Warn about columns in DB that are no longer in the schema
    for (const existingCol of currentCols) {
      if (existingCol === 'id') continue
      const stillDesired = Object.entries(fields).some(
        ([k, f]) => getColumnName(k, f) === existingCol
      )
      if (!stillDesired) {
        warnings.push(
          `    // WARNING: '${modelName}.${existingCol}' is no longer in your better-auth config.`,
          `    // Remove it manually if desired:`,
          `    // this.schema.table('${modelName}', (table) => { table.dropColumn('${existingCol}') })`
        )
      }
    }
  }

  // Warn about entire tables that exist in DB but were removed from config.
  for (const existingTable of existingTables) {
    if (!desiredTableNames.has(existingTable)) {
      const wasOurs = activeTables.some((t) => t.modelName === existingTable)
      if (wasOurs) {
        warnings.push(
          `    // WARNING: Table '${existingTable}' exists in DB but is no longer in your config.`,
          `    // Drop it manually if desired:`,
          `    // this.schema.dropTableIfExists('${existingTable}')`
        )
      }
    }
  }

  if (upStatements.length === 0 && warnings.length === 0) {
    return {
      code: `// better-auth schema is already in sync with your database. No changes needed.\n`,
      path: outputPath,
      overwrite: false,
    }
  }

  const upBody = [...upStatements, ...(warnings.length > 0 ? ['', ...warnings] : [])].join('\n\n')

  const downBody =
    downStatements.length > 0
      ? downStatements.join('\n\n')
      : '    // No automatic rollback for incremental changes — run manually if needed.'

  return {
    code: wrapInBaseSchema(upBody, downBody),
    path: outputPath,
    overwrite: false,
  }
}

/** @internal Exported for unit testing only. */
export const adapterTestHelpers = {
  camelToSnake: (s: string) => camelToSnake(s),
  buildColumnChain: (k: string, f: DBFieldAttribute, t: BetterAuthDBSchema) =>
    buildColumnChain(k, f, t),
  generateCreateTableBlock: (
    m: string,
    f: Record<string, DBFieldAttribute>,
    t: BetterAuthDBSchema,
    i: string
  ) => generateCreateTableBlock(m, f, t, i),
  wrapInBaseSchema: (up: string, down: string) => wrapInBaseSchema(up, down),
  generateLucidMigration: (db: Database, tables: BetterAuthDBSchema, file?: string) =>
    generateLucidMigration(db, tables, file),
}

// ============================================================================
// WHERE condition helper (used by CRUD operations)
// ============================================================================

/**
 * Applies an array of better-auth CleanedWhere conditions to a Lucid query builder.
 *
 * The first condition always uses .where() / .whereIn().
 * Subsequent conditions check the `connector` field:
 *   - "OR"  → .orWhere() / .orWhereIn()
 *   - "AND" (default) → .andWhere() / .andWhereIn()
 */
function applyWhereConditions(query: any, where: CleanedWhere[]): void {
  for (const [i, { field, value, operator, connector }] of where.entries()) {
    const useOr = i > 0 && connector === 'OR'

    switch (operator) {
      case 'in':
        if (useOr) {
          query.orWhereIn(field, Array.isArray(value) ? value : [value])
        } else {
          query.whereIn(field, Array.isArray(value) ? value : [value])
        }
        break

      case 'not_in':
        if (useOr) {
          query.orWhereNotIn(field, Array.isArray(value) ? value : [value])
        } else {
          query.whereNotIn(field, Array.isArray(value) ? value : [value])
        }
        break

      case 'contains':
        if (useOr) {
          query.orWhere(field, 'like', `%${value}%`)
        } else {
          query.where(field, 'like', `%${value}%`)
        }
        break

      case 'starts_with':
        if (useOr) {
          query.orWhere(field, 'like', `${value}%`)
        } else {
          query.where(field, 'like', `${value}%`)
        }
        break

      case 'ends_with':
        if (useOr) {
          query.orWhere(field, 'like', `%${value}`)
        } else {
          query.where(field, 'like', `%${value}`)
        }
        break

      default: {
        const opMap: Record<string, string> = {
          eq: '=',
          ne: '!=',
          lt: '<',
          lte: '<=',
          gt: '>',
          gte: '>=',
        }
        const sqlOp = opMap[operator] ?? '='
        if (useOr) {
          query.orWhere(field, sqlOp, value)
        } else {
          query.where(field, sqlOp, value)
        }
      }
    }
  }
}

// ============================================================================
// Adapter factory
// ============================================================================

/**
 * Creates a better-auth database adapter backed by AdonisJS Lucid's
 * raw query builder. Targets PostgreSQL as the primary database.
 *
 * @param db  - The AdonisJS Lucid Database instance
 * @param config - Optional adapter configuration
 */
export const lucidAdapter = (db: Database, config: LucidAdapterConfig = {}) =>
  createAdapterFactory({
    config: {
      adapterId: 'lucid',
      adapterName: 'AdonisJS Lucid Adapter',
      usePlural: config.usePlural ?? false,
      debugLogs: config.debugLogs ?? false,

      // PostgreSQL natively supports JSON/JSONB columns.
      supportsJSON: true,

      // Let better-auth pass real Date objects; Knex handles serialization.
      supportsDates: true,

      // PostgreSQL handles booleans natively.
      supportsBooleans: true,

      // better-auth generates string IDs (nanoid-based) by default.
      supportsNumericIds: false,

      // PostgreSQL supports ARRAY columns, but better-auth rarely uses them.
      supportsArrays: false,

      // Transaction support: delegate to Lucid's transaction() callback API.
      transaction: async <R>(callback: (trx: any) => Promise<R>): Promise<R> => {
        return db.transaction(async (trx) => {
          return callback(trx)
        })
      },
    },

    adapter: ({
      getModelName,
      getDefaultModelName,
      transformInput,
      transformOutput,
      transformWhereClause,
    }) => ({
      // ----------------------------------------------------------------
      // CREATE
      // ----------------------------------------------------------------
      async create({ model, data, select }) {
        const tableName = getModelName(model)
        const defaultModelName = getDefaultModelName(model)

        const transformed = await transformInput(
          data as Record<string, unknown>,
          defaultModelName,
          'create'
        )

        const [row] = await db.table(tableName).insert(transformed).returning('*')

        return transformOutput(row, defaultModelName, select) as any
      },

      // ----------------------------------------------------------------
      // FIND ONE
      // ----------------------------------------------------------------
      async findOne({ model, where, select }) {
        const tableName = getModelName(model)
        const defaultModelName = getDefaultModelName(model)

        const cleanedWhere = transformWhereClause({ model, where, action: 'findOne' })

        const query = db.from(tableName)
        if (cleanedWhere && cleanedWhere.length > 0) {
          applyWhereConditions(query, cleanedWhere)
        }

        const row = await query.first()
        if (!row) return null

        return transformOutput(row, defaultModelName, select) as any
      },

      // ----------------------------------------------------------------
      // FIND MANY
      // ----------------------------------------------------------------
      async findMany({ model, where, limit, sortBy, offset, select }) {
        const tableName = getModelName(model)
        const defaultModelName = getDefaultModelName(model)

        const cleanedWhere = transformWhereClause({ model, where, action: 'findMany' })

        const query = db.from(tableName)

        if (cleanedWhere && cleanedWhere.length > 0) {
          applyWhereConditions(query, cleanedWhere)
        }

        if (sortBy) {
          query.orderBy(sortBy.field, sortBy.direction)
        }

        if (limit !== undefined && limit !== null) {
          query.limit(limit)
        }

        if (offset !== undefined && offset !== null) {
          query.offset(offset)
        }

        const rows = await query

        return Promise.all(
          rows.map((row: Record<string, unknown>) => transformOutput(row, defaultModelName, select))
        ) as any
      },

      // ----------------------------------------------------------------
      // UPDATE
      // ----------------------------------------------------------------
      async update({ model, where, update }) {
        const tableName = getModelName(model)
        const defaultModelName = getDefaultModelName(model)

        const cleanedWhere = transformWhereClause({ model, where, action: 'update' })
        const transformed = await transformInput(
          update as Record<string, unknown>,
          defaultModelName,
          'update'
        )

        const query = db.from(tableName)
        if (cleanedWhere && cleanedWhere.length > 0) {
          applyWhereConditions(query, cleanedWhere)
        }

        const [row] = await query.update(transformed).returning('*')
        if (!row) return null

        return transformOutput(row, defaultModelName) as any
      },

      // ----------------------------------------------------------------
      // UPDATE MANY
      // ----------------------------------------------------------------
      async updateMany({ model, where, update }) {
        const tableName = getModelName(model)
        const defaultModelName = getDefaultModelName(model)

        const cleanedWhere = transformWhereClause({ model, where, action: 'updateMany' })
        const transformed = await transformInput(update, defaultModelName, 'update')

        const query = db.from(tableName)
        if (cleanedWhere && cleanedWhere.length > 0) {
          applyWhereConditions(query, cleanedWhere)
        }

        return query.update(transformed) as any
      },

      // ----------------------------------------------------------------
      // DELETE
      // ----------------------------------------------------------------
      async delete({ model, where }) {
        const tableName = getModelName(model)

        const cleanedWhere = transformWhereClause({ model, where, action: 'delete' })

        const query = db.from(tableName)
        if (cleanedWhere && cleanedWhere.length > 0) {
          applyWhereConditions(query, cleanedWhere)
        }

        await query.delete()
      },

      // ----------------------------------------------------------------
      // DELETE MANY
      // ----------------------------------------------------------------
      async deleteMany({ model, where }) {
        const tableName = getModelName(model)

        const cleanedWhere = transformWhereClause({ model, where, action: 'deleteMany' })

        const query = db.from(tableName)
        if (cleanedWhere && cleanedWhere.length > 0) {
          applyWhereConditions(query, cleanedWhere)
        }

        return query.delete() as any
      },

      // ----------------------------------------------------------------
      // COUNT
      // ----------------------------------------------------------------
      async count({ model, where }) {
        const tableName = getModelName(model)

        const cleanedWhere = transformWhereClause({ model, where, action: 'count' })

        const query = db.from(tableName)
        if (cleanedWhere && cleanedWhere.length > 0) {
          applyWhereConditions(query, cleanedWhere)
        }

        const [result] = await query.count('* as total')
        return Number(result?.total ?? result?.['count(*)'] ?? 0)
      },

      // ----------------------------------------------------------------
      // CREATE SCHEMA
      //
      // Delegates to generateLucidMigration (see above). The factory wrapper
      // ignores the first argument and derives `tables` from getAuthTables(options),
      // so the logic lives in the standalone function for direct testability.
      // ----------------------------------------------------------------
      async createSchema({ file, tables }) {
        return generateLucidMigration(db, tables, file)
      },
    }),
  })
