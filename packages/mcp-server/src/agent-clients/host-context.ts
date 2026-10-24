import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'

const DirectorySchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => isAbsolute(value) && !value.includes('\0'))

/** Private CLI-to-Hub metadata. These paths locate a host; they do not establish ownership. */
export const HostContextSchema = z
  .object({
    version: z.literal(1),
    home: DirectorySchema,
    tempDir: DirectorySchema,
    codexHome: DirectorySchema,
    codexSqliteHome: DirectorySchema
  })
  .strict()
export type HostContext = z.infer<typeof HostContextSchema>

export const MISSING_HOST_CONTEXT_MESSAGE =
  'Update TemPad Dev MCP and restart its MCP server in your host; reconnecting the existing process is not enough. Comments stay saved and are never delivered through hooks.'

// Keep the existing identity notification unchanged so older Hubs still recognize new CLIs.
export const HostContextNotificationSchema = z.object({
  method: z.literal('notifications/tempad/host-context'),
  params: HostContextSchema
})

/** Resolve defaults and relative host overrides in the originating CLI, never in the Hub. */
export function captureHostContext(env: NodeJS.ProcessEnv): HostContext {
  const home = resolve(env.HOME || env.USERPROFILE || homedir())
  const codexHome = resolve(env.CODEX_HOME || join(home, '.codex'))
  return HostContextSchema.parse({
    version: 1,
    home,
    tempDir: resolve(env.TMPDIR || env.TEMP || env.TMP || tmpdir()),
    codexHome,
    codexSqliteHome: resolve(env.CODEX_SQLITE_HOME || codexHome)
  })
}

export function requireHostContext(context?: HostContext): HostContext {
  if (!context) throw new Error(MISSING_HOST_CONTEXT_MESSAGE)
  return context
}

/** Discovery inputs may change without changing the native conversation's storage. */
export function codexStoreKey(context?: HostContext): string {
  return context ? JSON.stringify([context.codexHome, context.codexSqliteHome]) : ''
}

export function codexConversationKey(conversationId: string, context?: HostContext): string {
  return JSON.stringify([codexStoreKey(context), conversationId])
}

/** Keep discovery caches and immutable connection registrations sensitive to every input. */
export function hostContextKey(context?: HostContext): string {
  return context
    ? JSON.stringify([
        context.version,
        context.home,
        context.tempDir,
        context.codexHome,
        context.codexSqliteHome
      ])
    : ''
}

export function hostConversationKey(conversationId: string, context?: HostContext): string {
  return JSON.stringify([hostContextKey(context), conversationId])
}
