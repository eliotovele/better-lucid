import { test } from '@japa/runner'
import { adapterTestHelpers, lucidAdapter } from '../../src/adapter.js'

// ---------------------------------------------------------------------------
// Mock Lucid `db` object
// ---------------------------------------------------------------------------
// These tests use a lightweight mock of the Lucid Database so they run
// without a real PostgreSQL connection. End-to-end adapter tests against
// a live DB can be added in tests/functional/.

function createMockDb(overrides: Record<string, any> = {}) {
  const mockQuery = {
    where: () => mockQuery,
    orWhere: () => mockQuery,
    whereIn: () => mockQuery,
    orWhereIn: () => mockQuery,
    whereNotIn: () => mockQuery,
    orWhereNotIn: () => mockQuery,
    orderBy: () => mockQuery,
    limit: () => mockQuery,
    offset: () => mockQuery,
    first: async () => null,
    delete: async () => 0,
    update: async () => [null],
    count: async () => [{ total: '0' }],
    returning: () => mockQuery,
    then: (fn: any) => Promise.resolve([]).then(fn),
    ...overrides,
  }

  return {
    from: () => mockQuery,
    table: () => ({
      insert: () => ({
        returning: async () => [overrides.insertResult ?? null],
      }),
    }),
    transaction: async (cb: any) => cb({}),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.group('lucidAdapter — factory', () => {
  test('returns an AdapterFactory (function)', ({ assert }) => {
    const db = createMockDb() as any
    const factory = lucidAdapter(db)
    assert.isFunction(factory)
  })

  test('accepts optional config', ({ assert }) => {
    const db = createMockDb() as any
    const factory = lucidAdapter(db, { usePlural: true, debugLogs: false })
    assert.isFunction(factory)
  })
})

test.group('lucidAdapter — applyWhereConditions operators', () => {
  /**
   * We test the where-condition logic by calling the adapter with a real
   * betterAuth-like `findOne` invocation and verifying the mock query
   * builder received the correct method calls.
   */

  function makeAdapter(dbOverrides: Record<string, any> = {}) {
    const calls: string[] = []

    const mockQuery = {
      where: (...args: any[]) => {
        calls.push(`where:${args[0]}:${args[1]}:${args[2]}`)
        return mockQuery
      },
      orWhere: (...args: any[]) => {
        calls.push(`orWhere:${args[0]}`)
        return mockQuery
      },
      whereIn: (...args: any[]) => {
        calls.push(`whereIn:${args[0]}`)
        return mockQuery
      },
      orWhereIn: (...args: any[]) => {
        calls.push(`orWhereIn:${args[0]}`)
        return mockQuery
      },
      whereNotIn: (...args: any[]) => {
        calls.push(`whereNotIn:${args[0]}`)
        return mockQuery
      },
      first: async () => null,
      delete: async () => 0,
      update: async () => [null],
      count: async () => [{ total: '0' }],
      returning: () => mockQuery,
      then: (fn: any) => Promise.resolve([]).then(fn),
    }

    const db = {
      from: () => mockQuery,
      table: () => ({ insert: () => ({ returning: async () => [null] }) }),
      transaction: async (cb: any) => cb({}),
      ...dbOverrides,
    } as any

    return { adapter: lucidAdapter(db), calls }
  }

  test('eq operator uses = by default', async ({ assert }) => {
    const { adapter, calls } = makeAdapter()
    // The adapter factory returns a function; calling it with a minimal
    // options object gives us the DBAdapter
    const dbAdapter = adapter({ baseURL: 'http://localhost' } as any)
    await dbAdapter.findOne({
      model: 'user',
      where: [{ field: 'email', value: 'test@example.com' }],
    })
    assert.isTrue(calls.some((c) => c.includes('where:email:=')))
  })

  test('in operator uses whereIn', async ({ assert }) => {
    const { adapter, calls } = makeAdapter()
    const dbAdapter = adapter({ baseURL: 'http://localhost' } as any)
    await dbAdapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: ['a', 'b'], operator: 'in' }],
    })
    assert.isTrue(calls.some((c) => c.startsWith('whereIn:id')))
  })

  test('ne operator uses !=', async ({ assert }) => {
    const { adapter, calls } = makeAdapter()
    const dbAdapter = adapter({ baseURL: 'http://localhost' } as any)
    // Use a valid better-auth user field ('email') to pass schema validation
    await dbAdapter.findOne({
      model: 'user',
      where: [{ field: 'email', value: 'banned@example.com', operator: 'ne' }],
    })
    assert.isTrue(calls.some((c) => c.includes('where:') && c.includes('!=')))
  })

  test('OR connector uses orWhere for subsequent conditions', async ({ assert }) => {
    const { adapter, calls } = makeAdapter()
    const dbAdapter = adapter({ baseURL: 'http://localhost' } as any)
    await dbAdapter.findOne({
      model: 'user',
      where: [
        { field: 'email', value: 'a@example.com', operator: 'eq', connector: 'AND' },
        { field: 'email', value: 'b@example.com', operator: 'eq', connector: 'OR' },
      ],
    })
    assert.isTrue(calls.some((c) => c.startsWith('orWhere:email')))
  })
})

test.group('lucidAdapter — count', () => {
  test('parses numeric total from result', async ({ assert }) => {
    // Override count to return a numeric-like result
    const mockQuery = {
      where: () => mockQuery,
      count: async () => [{ total: '42' }],
    }
    const mockDb = {
      from: () => mockQuery,
      table: () => ({}),
      transaction: async (cb: any) => cb({}),
    } as any

    const dbAdapter = lucidAdapter(mockDb)({ baseURL: 'http://localhost' } as any)
    const result = await dbAdapter.count({ model: 'user' })
    assert.equal(result, 42)
  })

  test('returns 0 when count result is empty', async ({ assert }) => {
    const mockQuery = {
      where: () => mockQuery,
      count: async () => [{}],
    }
    const mockDb = {
      from: () => mockQuery,
      table: () => ({}),
      transaction: async (cb: any) => cb({}),
    } as any

    const dbAdapter = lucidAdapter(mockDb)({ baseURL: 'http://localhost' } as any)
    const result = await dbAdapter.count({ model: 'user' })
    assert.equal(result, 0)
  })
})

test.group('lucidAdapter — delete', () => {
  test('delete resolves without error', async ({ assert }) => {
    const db = createMockDb() as any
    const dbAdapter = lucidAdapter(db)({ baseURL: 'http://localhost' } as any)
    await assert.doesNotReject(() =>
      dbAdapter.delete({ model: 'session', where: [{ field: 'id', value: 'abc' }] })
    )
  })
})

// ---------------------------------------------------------------------------
// createSchema tests
// ---------------------------------------------------------------------------
//
// We build a minimal mock db that returns controlled information_schema
// results so tests run without a live PostgreSQL connection.

/**
 * Builds a mock db whose `from('information_schema.tables')` returns the
 * given set of existing table names, and whose columns query returns the
 * given column map.
 */
function makeSchemaDb(existingTables: string[], existingColumns: Record<string, string[]> = {}) {
  function mockQuery(rows: any[]) {
    const q: any = {
      where: () => q,
      whereIn: () => q,
      select: () => q,
      then: (fn: any) => Promise.resolve(rows).then(fn),
      [Symbol.iterator]: undefined,
    }
    // Make it thenable AND array-like so `await q` works
    q[Symbol.iterator] = rows[Symbol.iterator].bind(rows)
    return q
  }

  return {
    from: (table: string) => {
      if (table === 'information_schema.tables') {
        return mockQuery(existingTables.map((t) => ({ table_name: t })))
      }
      if (table === 'information_schema.columns') {
        const rows: any[] = []
        for (const [tbl, cols] of Object.entries(existingColumns)) {
          for (const col of cols) {
            rows.push({ table_name: tbl, column_name: col })
          }
        }
        return mockQuery(rows)
      }
      return mockQuery([])
    },
    table: () => ({ insert: () => ({ returning: async () => [null] }) }),
    transaction: async (cb: any) => cb({}),
  } as any
}

/** Minimal schema shaped like BetterAuthDBSchema for the core 4 tables. */
const CORE_SCHEMA: any = {
  user: {
    modelName: 'user',
    order: 1,
    fields: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true, sortable: true },
      email: { type: 'string', required: true, sortable: true, unique: true },
      emailVerified: { type: 'boolean', required: true },
      image: { type: 'string', required: false },
      createdAt: { type: 'date', required: true },
      updatedAt: { type: 'date', required: true },
    },
  },
  session: {
    modelName: 'session',
    order: 2,
    fields: {
      id: { type: 'string', required: true },
      userId: {
        type: 'string',
        required: true,
        references: { model: 'user', field: 'id', onDelete: 'cascade' },
      },
      token: { type: 'string', required: true, unique: true, sortable: true },
      expiresAt: { type: 'date', required: true },
      createdAt: { type: 'date', required: true },
      updatedAt: { type: 'date', required: true },
    },
  },
  account: { modelName: 'account', order: 3, fields: { id: { type: 'string', required: true } } },
  verification: {
    modelName: 'verification',
    order: 4,
    fields: { id: { type: 'string', required: true } },
  },
}

test.group('lucidAdapter — createSchema (fresh DB)', () => {
  test('generates CREATE TABLE for all 4 core tables', async ({ assert }) => {
    const db = makeSchemaDb([]) // empty DB
    const result = await adapterTestHelpers.generateLucidMigration(db, CORE_SCHEMA)

    assert.include(result.code, "createTable('user'")
    assert.include(result.code, "createTable('session'")
    assert.include(result.code, "createTable('account'")
    assert.include(result.code, "createTable('verification'")
  })

  test('user table appears before session in generated code', async ({ assert }) => {
    const db = makeSchemaDb([])
    const result = await adapterTestHelpers.generateLucidMigration(db, CORE_SCHEMA)

    const userPos = result.code.indexOf("createTable('user'")
    const sessionPos = result.code.indexOf("createTable('session'")
    assert.isBelow(userPos, sessionPos)
  })

  test('includes plugin table when schema has twoFactor', async ({ assert }) => {
    const schemaWithPlugin: any = {
      ...CORE_SCHEMA,
      user: {
        ...CORE_SCHEMA.user,
        fields: {
          ...CORE_SCHEMA.user.fields,
          twoFactorEnabled: { type: 'boolean', required: false },
        },
      },
      twoFactor: {
        modelName: 'twoFactor',
        order: 5,
        fields: {
          id: { type: 'string', required: true },
          userId: {
            type: 'string',
            required: true,
            references: { model: 'user', field: 'id', onDelete: 'cascade' },
          },
          secret: { type: 'string', required: true },
          backupCodes: { type: 'string', required: true },
        },
      },
    }

    const db = makeSchemaDb([])
    const result = await adapterTestHelpers.generateLucidMigration(db, schemaWithPlugin)

    assert.include(result.code, "createTable('twoFactor'")
    assert.include(result.code, 'two_factor_enabled')
  })

  test('skips tables with disableMigrations: true', async ({ assert }) => {
    const schema: any = {
      ...CORE_SCHEMA,
      skipMe: {
        modelName: 'skip_me',
        order: 10,
        disableMigrations: true,
        fields: { id: { type: 'string', required: true } },
      },
    }

    const db = makeSchemaDb([])
    const result = await adapterTestHelpers.generateLucidMigration(db, schema)

    assert.notInclude(result.code, 'skip_me')
  })

  test('maps field types correctly', async ({ assert }) => {
    const db = makeSchemaDb([])
    const result = await adapterTestHelpers.generateLucidMigration(db, CORE_SCHEMA)
    const { code } = result

    // sortable string → string('col'), non-sortable → text('col')
    assert.include(code, "string('name'")
    assert.include(code, "text('image'")
    // date → timestamp
    assert.include(code, "timestamp('created_at'")
    // FK chain
    assert.include(code, ".references('id').inTable('user').onDelete('CASCADE')")
  })

  test('generates down() with dropTableIfExists in reverse order', async ({ assert }) => {
    const db = makeSchemaDb([])
    const result = await adapterTestHelpers.generateLucidMigration(db, CORE_SCHEMA)

    assert.include(result.code, 'dropTableIfExists')
    // user must appear AFTER session in the down() block (reverse order)
    const sessionDropPos = result.code.lastIndexOf("dropTableIfExists('session'")
    const userDropPos = result.code.lastIndexOf("dropTableIfExists('user'")
    assert.isAbove(userDropPos, sessionDropPos)
  })
})

test.group('lucidAdapter — createSchema (incremental / existing DB)', () => {
  test('generates ADD COLUMN for new plugin field on existing table', async ({ assert }) => {
    const schemaWithPlugin: any = {
      ...CORE_SCHEMA,
      user: {
        ...CORE_SCHEMA.user,
        fields: {
          ...CORE_SCHEMA.user.fields,
          twoFactorEnabled: { type: 'boolean', required: false },
        },
      },
    }

    // All 4 core tables exist, user has all core columns but NOT two_factor_enabled
    const db = makeSchemaDb(['user', 'session', 'account', 'verification'], {
      user: ['id', 'name', 'email', 'email_verified', 'image', 'created_at', 'updated_at'],
      session: ['id', 'user_id', 'token', 'expires_at', 'created_at', 'updated_at'],
      account: ['id'],
      verification: ['id'],
    })

    const result = await adapterTestHelpers.generateLucidMigration(db, schemaWithPlugin)

    // Should use schema.table() to ALTER, NOT createTable
    assert.include(result.code, "this.schema.table('user'")
    assert.include(result.code, 'two_factor_enabled')
    assert.notInclude(result.code, "createTable('user'")
  })

  test('generates CREATE TABLE for new plugin table when core tables exist', async ({ assert }) => {
    const schemaWithPlugin: any = {
      ...CORE_SCHEMA,
      twoFactor: {
        modelName: 'twoFactor',
        order: 5,
        fields: {
          id: { type: 'string', required: true },
          userId: { type: 'string', required: true },
          secret: { type: 'string', required: true },
        },
      },
    }

    const db = makeSchemaDb(['user', 'session', 'account', 'verification'], {})
    const result = await adapterTestHelpers.generateLucidMigration(db, schemaWithPlugin)

    assert.include(result.code, "createTable('twoFactor'")
    assert.notInclude(result.code, "createTable('user'")
  })

  test('returns no-changes comment when schema is already in sync', async ({ assert }) => {
    // All tables and all columns already present
    const db = makeSchemaDb(['user', 'session', 'account', 'verification'], {
      user: ['id', 'name', 'email', 'email_verified', 'image', 'created_at', 'updated_at'],
      session: ['id', 'user_id', 'token', 'expires_at', 'created_at', 'updated_at'],
      account: ['id'],
      verification: ['id'],
    })

    const result = await adapterTestHelpers.generateLucidMigration(db, CORE_SCHEMA)

    assert.include(result.code, 'No changes needed')
  })

  test('emits WARNING comment for removed column (no DROP generated)', async ({ assert }) => {
    // DB has an extra column 'old_column' not in the schema
    const db = makeSchemaDb(['user', 'session', 'account', 'verification'], {
      user: [
        'id',
        'name',
        'email',
        'email_verified',
        'image',
        'created_at',
        'updated_at',
        'old_column', // stale column
      ],
      session: ['id', 'user_id', 'token', 'expires_at', 'created_at', 'updated_at'],
      account: ['id'],
      verification: ['id'],
    })

    const result = await adapterTestHelpers.generateLucidMigration(db, CORE_SCHEMA)

    assert.include(result.code, 'WARNING')
    assert.include(result.code, 'old_column')
    // WARNING is a comment — no actual dropColumn call
    assert.notInclude(result.code.replace(/\/\/.*/g, ''), 'dropColumn')
  })
})
