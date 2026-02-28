/**
 * Ambient module declarations for AdonisJS path aliases that exist in the
 * consuming project but not in this library's package.json.
 *
 * These declarations tell TypeScript "this module exists" so the library
 * can compile. The actual resolution happens at runtime via the user's
 * Node.js ESM loader configured in their project.
 */

declare module '#start/auth' {
  const auth: any
  export default auth
}
