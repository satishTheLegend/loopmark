import { server } from './server.ts'
/** Operational projections contain no craft bodies, credentials, URLs or raw operation IDs. */
export async function observe(
  owner: string,
  route: 'sync' | 'media' | 'billing',
  phase: 'start' | 'success' | 'retry' | 'error' | 'conflict',
  operation: string | null = null,
  elapsed = 0,
) {
  try {
    const digest =
      operation === null
        ? null
        : Array.from(
            new Uint8Array(
              await crypto.subtle.digest('SHA-256', new TextEncoder().encode(operation)),
            ),
            (x) => x.toString(16).padStart(2, '0'),
          ).join('')
    const { client } = server(AbortSignal.timeout(2000))
    await client.rpc('loopmark_ops_observe', {
      p_owner: owner,
      p_route: route,
      p_phase: phase,
      p_operation: digest,
      p_elapsed: Math.max(0, Math.min(300000, Math.round(elapsed))),
    })
  } catch {
    /* Monitoring cannot change a committed command's outcome. */
  }
}
