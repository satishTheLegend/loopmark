import { createHmac, timingSafeEqual } from 'node:crypto'
import { OpsError, uuid } from './common.mjs'
export const resumable = new Set([
  'maintenance',
  'replay-webhooks',
  'reconcile-purchases',
  'resume-deletions',
])
export function encodeCursor(ctx, options, jobId, position = null) {
  const value = Buffer.from(
    JSON.stringify({
      version: 1,
      project: ctx.config.projectId,
      command: options.command,
      target: options.target,
      jobId,
      position,
    }),
  ).toString('base64url')
  return value + '.' + createHmac('sha256', ctx.key).update(value).digest('base64url')
}
export function decodeCursor(ctx, options) {
  if (!options.cursor) return null
  try {
    const [value, signature] = options.cursor.split('.')
    const expected = createHmac('sha256', ctx.key).update(value).digest(),
      actual = Buffer.from(signature, 'base64url')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error()
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (
      parsed.version !== 1 ||
      parsed.project !== ctx.config.projectId ||
      parsed.command !== options.command ||
      parsed.target !== options.target ||
      !uuid.test(parsed.jobId) ||
      !(
        parsed.position === null ||
        (Number.isSafeInteger(parsed.position) && parsed.position >= 0)
      ) ||
      Object.keys(parsed).length !== 6
    )
      throw new Error()
    if ((options.command === 'maintenance') !== (parsed.position !== null)) throw new Error()
    return parsed
  } catch {
    throw new OpsError('NOT_AVAILABLE')
  }
}
