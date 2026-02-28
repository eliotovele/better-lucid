# better-lucid

> [better-auth](https://www.better-auth.com) database adapter for **AdonisJS 6** + **Lucid ORM**

Connects better-auth to AdonisJS using Lucid's raw query builder (no Models required). Works with PostgreSQL.

---

## Requirements

| Peer dependency | Version |
|---|---|
| `@adonisjs/core` | `^6.2.0` |
| `@adonisjs/lucid` | `^21.0.0` |
| `better-auth` | `^1.0.0` |
| Database | **PostgreSQL** |

---

## Installation

```sh
npm install better-lucid
node ace configure better-lucid
```

The configure script:
- Publishes a migration to `database/migrations/`
- Registers `LucidBetterAuthProvider` in `adonisrc.ts`
- Registers the `betterAuth` named middleware in `start/kernel.ts`

---

## Setup

### 1. Create `start/auth.ts`

```ts
import { betterAuth } from 'better-auth'
import { lucidAdapter } from 'better-lucid'
import db from '@adonisjs/lucid/services/db'

export default betterAuth({
  database: lucidAdapter(db),
  emailAndPassword: {
    enabled: true,
  },
  // ...other better-auth options
})
```

### 2. Run the migration

```sh
node ace migration:run
```

### 3. Mount the better-auth handler in `start/routes.ts`

```ts
import router from '@adonisjs/core/services/router'

router.all('/api/auth/*', async ({ request, response }) => {
  const { default: auth } = await import('#start/auth')
  return auth.handler(request.request, response.response)
})
```

### 4. Protect routes with the middleware

```ts
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// Apply to a single route
router.get('/me', async ({ auth, response }) => {
  if (!auth.user) return response.unauthorized()
  return auth.user
}).use(middleware.betterAuth())

// Apply to a group
router.group(() => {
  router.get('/profile', ProfileController)
  router.put('/settings', SettingsController)
}).use(middleware.betterAuth())
```

The middleware sets `ctx.auth`:

```ts
import type { BetterAuthContext } from 'better-lucid/types'

// ctx.auth.user    — BetterAuthUser | null
// ctx.auth.session — BetterAuthSession | null
```

---

## Adapter configuration

```ts
import { lucidAdapter } from 'better-lucid'
import type { LucidAdapterConfig } from 'better-lucid'

const config: LucidAdapterConfig = {
  /** Log all adapter queries to the console. Default: false */
  debugLogs: true,

  /** Use plural table names ("users" instead of "user"). Default: false */
  usePlural: false,
}

lucidAdapter(db, config)
```

---

## Plugin schema sync

better-auth plugins add new tables and columns. After adding a plugin to `start/auth.ts`, regenerate an incremental migration:

```ts
// In any AdonisJS route, command, or script:
const { default: auth } = await import('#start/auth')
await auth.api.generateSchema()
// → writes database/migrations/<timestamp>_better_auth_schema.ts
```

Then run it:

```sh
node ace migration:run
```

The generator diffs your live database against the current config and emits only the changes:

- **New plugin tables** → `CREATE TABLE`
- **New plugin columns on existing tables** → `ALTER TABLE ADD COLUMN`
- **Removed columns / tables** → `// WARNING:` comments — destructive operations are always run manually

---

## How it works

`lucidAdapter(db)` returns an [AdapterFactory](https://www.better-auth.com/docs/concepts/database#adapters) backed by Lucid's raw query builder. It handles:

- All CRUD operations (create, findOne, findMany, update, updateMany, delete, deleteMany, count)
- Full WHERE clause support: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `contains`, `starts_with`, `ends_with`, `AND`/`OR` connectors
- Transactions (delegated to `db.transaction()`)
- Schema generation for fresh and incremental migrations (via `createSchema`)
- `camelCase` schema keys → `snake_case` column names automatically

---

## License

MIT
