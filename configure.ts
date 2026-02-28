/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| Called when a user runs `node ace configure better-lucid`.
| This script creates the migration file and registers the provider
| and named middleware in the user's AdonisJS project.
|
*/

import ConfigureCommand from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'

export async function configure(command: ConfigureCommand) {
  const codemods = await command.createCodemods()

  /**
   * Step 1: Publish the migration stub with a timestamp prefix
   */
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')

  await codemods.makeUsingStub(stubsRoot, 'migrations/create_better_auth_tables.stub', {
    migration: {
      tableName: 'better_auth_tables',
      fileName: `${timestamp}_create_better_auth_tables`,
    },
  })

  /**
   * Step 2: Register the service provider in adonisrc.ts
   */
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('better-lucid/lucid_better_auth_provider')
  })

  /**
   * Step 3: Register betterAuth as a named middleware in start/kernel.ts
   */
  await codemods.registerMiddleware('named', [
    {
      name: 'betterAuth',
      path: 'better-lucid/middleware',
    },
  ])

  command.logger.success('better-lucid configured successfully')
  command.logger.info('')
  command.logger.info('Next steps:')
  command.logger.info(
    '  1. Create start/auth.ts and export your betterAuth() instance (see README)'
  )
  command.logger.info('  2. Run migrations: node ace migration:run')
  command.logger.info('  3. Mount the better-auth handler in start/routes.ts (see README)')
  command.logger.info('')
  command.logger.info('Using better-auth plugins?')
  command.logger.info(
    '  Plugins add tables and columns automatically. After updating start/auth.ts'
  )
  command.logger.info('  with plugins, regenerate an incremental migration via your auth instance:')
  command.logger.info('')
  command.logger.info('    const result = await auth.api.generateSchema()')
  command.logger.info('    // writes a new migration to database/migrations/')
  command.logger.info('')
  command.logger.info('  The generator diffs your live DB against the config and emits only the')
  command.logger.info('  changes (ALTER TABLE ADD COLUMN, CREATE TABLE). Removals are emitted as')
  command.logger.info('  comments — destructive operations are always run manually.')
}
