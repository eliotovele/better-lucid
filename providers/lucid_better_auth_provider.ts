/*
|--------------------------------------------------------------------------
| Lucid Better Auth Service Provider
|--------------------------------------------------------------------------
|
| Binds the better-auth instance into the AdonisJS IoC container so it
| can be resolved by middleware and other services without importing
| start/auth.ts directly.
|
| Add to adonisrc.ts providers array (done automatically by configure):
|   providers: [() => import('better-lucid/lucid_better_auth_provider')]
|
*/

import type { ApplicationService } from '@adonisjs/core/types'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    better_auth: any
  }
}

export default class LucidBetterAuthProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    /**
     * Bind the better-auth instance as a lazy singleton. The actual
     * instance is loaded from the user's `start/auth.ts` on first use.
     */
    this.app.container.singleton('better_auth', async () => {
      const { default: auth } = await import('#start/auth')
      return auth
    })
  }

  async boot() {}

  async shutdown() {}
}
