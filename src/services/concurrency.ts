/** A shared limiter bounds all callers, including nested UI and export work. */
export function limiter(max = 2) {
  if (!Number.isInteger(max) || max < 1 || max > 4) throw new RangeError('Invalid concurrency')
  let active = 0
  const waiting: Array<() => void> = []
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await work()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}
export async function mapBounded<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  max = 2,
): Promise<R[]> {
  const result = new Array<R>(items.length)
  let next = 0
  let failed = false,
    failure: unknown
  await Promise.all(
    Array.from({ length: Math.min(max, items.length) }, async () => {
      for (;;) {
        if (failed) return
        const index = next++
        if (index >= items.length) return
        try {
          result[index] = await work(items[index])
        } catch (error) {
          if (!failed) {
            failed = true
            failure = error
          }
          return
        }
      }
    }),
  )
  // Drain in-flight workers before callers release snapshots or other shared resources.
  if (failed) throw failure
  return result
}
