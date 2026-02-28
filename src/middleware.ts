/*
|--------------------------------------------------------------------------
| Better Auth Middleware
|--------------------------------------------------------------------------
|
| Named middleware that reads the current session from the request and
| populates `ctx.auth` with the authenticated user and session.
|
| Register in start/kernel.ts (done automatically by configure):
|   export const middleware = router.named({
|     betterAuth: () => import('better-lucid/middleware').then((m) => m.default),
|   })
|
| Apply to routes:
|   router.get('/me', handler).use(middleware.betterAuth())
|
*/

import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { fromNodeHeaders } from 'better-auth/node'

// Import types — triggers the HttpContext module augmentation
import type {} from './types.js'

export default class BetterAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // Lazy-import the user's auth instance to avoid circular deps at boot.
    const { default: auth } = await import('#start/auth')

    try {
      // fromNodeHeaders converts Node.js IncomingMessage headers to the
      // Web Headers format that better-auth's API expects.
      const sessionData = await auth.api.getSession({
        headers: fromNodeHeaders(ctx.request.request.headers),
      })

      ctx.auth = {
        session: (sessionData?.session ?? null) as any,
        user: (sessionData?.user ?? null) as any,
      }
    } catch (error) {
      ctx.auth = { session: null, user: null }
      ctx.logger.warn({ err: error }, '[better-lucid] getSession failed — ctx.auth set to null')
    }

    await next()
  }
}
