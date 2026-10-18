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
  await Promise.all(
    Array.from({ length: Math.min(max, items.length) }, async () => {
      for (;;) {
        const index = next++
        if (index >= items.length) return
        result[index] = await work(items[index])
      }
    }),
  )
  return result
}
