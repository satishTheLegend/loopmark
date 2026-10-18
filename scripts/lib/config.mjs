import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { z } from 'zod'

const port = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().min(1024).max(65535))
  .optional()
const schema = z
  .object({
    LOOPMARK_DEV_PROFILE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
      .optional(),
    LOOPMARK_DEV_APP_PORT: port,
    LOOPMARK_DEV_API_PORT: port,
    LOOPMARK_DEV_DB_PORT: port,
    LOOPMARK_DEV_STUDIO_PORT: port,
    LOOPMARK_DEV_MAIL_PORT: port,
    LOOPMARK_LOCAL_URL: z.string().optional(),
  })
  .strict()

export class OperatorConfigurationError extends Error {
  constructor(fields) {
    super(
      `Local configuration is invalid. Check: ${fields.join(', ')}. Use LOOPMARK_DEV_PROFILE or a documented port override; local endpoints must match this profile on loopback.`,
    )
    this.name = 'OperatorConfigurationError'
  }
}

export function parseOperatorConfig(environment = {}, worktree = process.cwd()) {
  const selected = Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) =>
        (key.startsWith('LOOPMARK_DEV_') || key === 'LOOPMARK_LOCAL_URL') &&
        value !== '' &&
        value !== undefined,
    ),
  )
  const parsed = schema.safeParse(selected)
  if (!parsed.success)
    throw new OperatorConfigurationError([
      ...new Set(
        parsed.error.issues.map((issue) =>
          schema.shape[issue.path[0]] ? issue.path[0] : 'local environment',
        ),
      ),
    ])
  const value = parsed.data
  const worktreePath = resolve(worktree)
  const hash = createHash('sha256').update(worktreePath).digest('hex')
  const name =
    basename(worktreePath)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16) || 'worktree'
  const profile = value.LOOPMARK_DEV_PROFILE ?? `${name}-${hash.slice(0, 8)}`
  const seed = createHash('sha256').update(profile).digest().readUInt32BE(0)
  const base = 20000 + (seed % 2000) * 20
  const ports = Object.freeze({
    app: value.LOOPMARK_DEV_APP_PORT ?? base,
    api: value.LOOPMARK_DEV_API_PORT ?? base + 1,
    db: value.LOOPMARK_DEV_DB_PORT ?? base + 2,
    studio: value.LOOPMARK_DEV_STUDIO_PORT ?? base + 3,
    mail: value.LOOPMARK_DEV_MAIL_PORT ?? base + 4,
  })
  if (new Set(Object.values(ports)).size !== Object.keys(ports).length)
    throw new OperatorConfigurationError(['duplicate local ports'])
  const backendUrl = `http://127.0.0.1:${ports.api}`
  if (value.LOOPMARK_LOCAL_URL) {
    try {
      const url = new URL(value.LOOPMARK_LOCAL_URL)
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.protocol !== 'http:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        Number(url.port) !== ports.api
      )
        throw new Error()
    } catch {
      throw new OperatorConfigurationError(['LOOPMARK_LOCAL_URL'])
    }
  }
  return Object.freeze({
    profile,
    projectId: `loopmark-${profile}`,
    worktree: worktreePath,
    host: '127.0.0.1',
    ports,
    appOrigin: `http://127.0.0.1:${ports.app}`,
    backendUrl,
  })
}

/** Explicit process environment wins, including an empty value used to disable an option. */
export async function loadOperatorConfig({
  environment = process.env,
  worktree = process.cwd(),
} = {}) {
  const root = await realpath(worktree)
  let local = {}
  try {
    local = parseEnv(await readFile(resolve(root, '.env.local'), 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new OperatorConfigurationError(['.env.local'])
  }
  const merged = { ...local, ...environment }
  return { config: parseOperatorConfig(merged, root), environment: merged }
}
