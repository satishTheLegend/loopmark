import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js'
import { z } from 'zod'
import type { PublicConfig } from '../config'
import type { AccountSession, SessionScope } from '../domain/contracts'
import { id, revisionSchema } from '../domain/schema'
import { canonicalJson } from '../domain/canonical-json'
import { DomainError } from '../domain/errors'
import { withRequestDeadline } from './http-client'

const hintSchema = z
  .object({
    owner_id: z.uuid(),
    collection_id: id,
    epoch: id,
    revision: revisionSchema,
    nonce: z.uuid(),
  })
  .strict()
type Binding = { session: AccountSession; scope: SessionScope }
type Client = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'realtime'>
/** Realtime payloads only invalidate a view. Every data read still goes through canonical pull. */
export function createRealtimeHints(options: {
  config: PublicConfig
  token: () => Promise<string | null>
  current: () => Binding | null
  onHint: () => void
  client?: Client
}) {
  let authorization: Promise<unknown> = Promise.resolve()
  let client = options.client,
    channel: RealtimeChannel | undefined,
    version = 0,
    disposed = false,
    pending: AbortController | undefined
  const stop = () => {
    version++
    pending?.abort(new DomainError('ACCOUNT_CHANGED'))
    pending = undefined
    const previous = channel
    channel = undefined
    if (previous && client) void client.removeChannel(previous).catch(() => {})
  }
  return {
    async start(): Promise<void> {
      stop()
      if (disposed) throw new DomainError('ACCOUNT_CHANGED')
      const config = options.config.cloud,
        bound = options.current()
      if (!config.enabled || !bound) throw new DomainError('CAPABILITY_UNAVAILABLE')
      if (
        canonicalJson(bound.session.collection) !== canonicalJson(bound.scope.key) ||
        canonicalJson(bound.session.device) !== canonicalJson(bound.scope.device)
      )
        throw new DomainError('ACCOUNT_CHANGED')
      const identity = (value: Binding | null) =>
        value
          ? {
              scope: value.scope,
              accountId: value.session.accountId,
              deletionGeneration: value.session.deletionGeneration,
              device: value.session.device,
              collection: value.session.collection,
            }
          : null
      const captured = structuredClone(bound),
        ticket = version,
        controller = new AbortController()
      pending = controller
      const current = () =>
        !disposed &&
        ticket === version &&
        canonicalJson(identity(options.current())) === canonicalJson(identity(captured))
      try {
        await withRequestDeadline(controller.signal, 15000, async (signal) => {
          const token = await options.token()
          signal.throwIfAborted()
          if (!current()) throw new DomainError('ACCOUNT_CHANGED')
          if (!token) throw new DomainError('AUTH_REQUIRED')
          client ??= createClient(config.url, config.publicKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          })
          const authorizedClient = client
          authorization = authorization
            .catch(() => {})
            .then(async () => {
              if (!current()) throw new DomainError('ACCOUNT_CHANGED')
              await authorizedClient.realtime.setAuth(token)
            })
          await authorization
          signal.throwIfAborted()
          if (!current()) throw new DomainError('ACCOUNT_CHANGED')
          const selected = client.channel(`loopmark-hints-${crypto.randomUUID()}`)
          channel = selected
          await new Promise<void>((resolve, reject) => {
            const abort = () => reject(signal.reason)
            const done = (error?: unknown) => {
              signal.removeEventListener('abort', abort)
              error ? reject(error) : resolve()
            }
            signal.addEventListener('abort', abort, { once: true })
            selected
              .on(
                'postgres_changes',
                {
                  event: '*',
                  schema: 'public',
                  table: 'loopmark_sync_hints',
                  filter: `owner_id=eq.${captured.session.accountId}`,
                },
                (payload) => {
                  if (!current()) return
                  const parsed = hintSchema.safeParse(payload.new)
                  if (!parsed.success) return
                  const hint = parsed.data
                  if (
                    hint.owner_id === captured.session.accountId &&
                    hint.collection_id === captured.scope.key.collectionId &&
                    hint.epoch === captured.scope.key.epoch
                  )
                    options.onHint()
                },
              )
              .on('system', {}, (payload) => {
                if (current() && payload.extension === 'postgres_changes') {
                  if (payload.status === 'ok') done()
                  else if (payload.status === 'error') done(new DomainError('SERVICE_UNAVAILABLE'))
                }
              })
              .subscribe((status) => {
                if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status))
                  done(new DomainError('SERVICE_UNAVAILABLE'))
              })
          })
          if (!current()) throw new DomainError('ACCOUNT_CHANGED')
        })
      } catch (error) {
        if (ticket === version) stop()
        throw error
      } finally {
        if (pending === controller) pending = undefined
      }
    },
    stop,
    dispose() {
      disposed = true
      stop()
    },
  }
}
