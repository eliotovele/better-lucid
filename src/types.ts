/*
|--------------------------------------------------------------------------
| Better Auth Types
|--------------------------------------------------------------------------
|
| Defines the BetterAuthContext interface that is added to the AdonisJS
| HttpContext via module augmentation. Import this file (or the middleware)
| to enable ctx.auth across your application.
|
*/

/**
 * Minimal representation of a better-auth Session object.
 * The full type is inferred from your betterAuth() instance via
 * `typeof auth.$Infer.Session`.
 */
export interface BetterAuthSession {
  id: string
  userId: string
  token: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  ipAddress?: string | null
  userAgent?: string | null
  [key: string]: unknown
}

/**
 * Minimal representation of a better-auth User object.
 * The full type is inferred from your betterAuth() instance via
 * `typeof auth.$Infer.User`.
 */
export interface BetterAuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
  createdAt: Date
  updatedAt: Date
  [key: string]: unknown
}

/**
 * Shape of `ctx.auth` populated by BetterAuthMiddleware.
 * Both fields are null when no valid session is present.
 */
export interface BetterAuthContext {
  session: BetterAuthSession | null
  user: BetterAuthUser | null
}

/**
 * Extends AdonisJS HttpContext with the `auth` property.
 * This augmentation takes effect globally once this module is imported.
 */
declare module '@adonisjs/core/http' {
  interface HttpContext {
    /**
     * The currently authenticated session and user.
     * Populated by BetterAuthMiddleware. Both are null when unauthenticated.
     */
    auth: BetterAuthContext
  }
}
