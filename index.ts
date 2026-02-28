/*
|--------------------------------------------------------------------------
| Package entrypoint
|--------------------------------------------------------------------------
|
| Export the public API of better-lucid.
|
| Users import:
|   import { lucidAdapter } from 'better-lucid'
|
| The provider and middleware are accessed via subpath exports:
|   'better-lucid/lucid_better_auth_provider'
|   'better-lucid/middleware'
|
*/

export { lucidAdapter } from './src/adapter.js'
export type { LucidAdapterConfig } from './src/adapter.js'
export type { BetterAuthContext, BetterAuthSession, BetterAuthUser } from './src/types.js'
