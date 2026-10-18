/** RSS is a sampled resident-set sum, not PSS/physical footprint; shared pages may be counted twice. */
export function iosMemory(text, appPid, parentPid) {
  const rows = text
    .trim()
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
      return match
        ? [
            {
              pid: Number(match[1]),
              parent: Number(match[2]),
              rssKiB: Number(match[3]),
              name: match[4],
            },
          ]
        : []
    })
  const included = rows.filter(
    (row) =>
      row.pid === appPid ||
      (row.parent === parentPid &&
        row.name.includes('/CoreSimulator/') &&
        /com\.apple\.WebKit\.(WebContent|GPU|Networking)$/.test(row.name)),
  )
  return summarize(
    included,
    (row) => row.pid === appPid,
    (row) => row.name.endsWith('.WebContent'),
  )
}
export function androidMemory(text, appId) {
  const rows = text
    .trim()
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/)
      return match
        ? [
            {
              pid: Number(match[1]),
              parent: Number(match[2]),
              rssKiB: Number(match[3]),
              name: match[4],
              args: match[5] ?? '',
            },
          ]
        : []
    })
  const renderer = (row) => /webview.*sandboxed_process/.test(row.args || row.name)
  return summarize(
    rows.filter((row) => row.name === appId || row.args === appId || renderer(row)),
    (row) => row.name === appId || row.args === appId,
    renderer,
  )
}
function summarize(rows, host, content) {
  const sum = (predicate) => rows.filter(predicate).reduce((total, row) => total + row.rssKiB, 0)
  return {
    hostKiB: sum(host),
    webContentKiB: sum(content),
    webSupportKiB: sum((row) => !host(row) && !content(row)),
    totalRssKiB: sum(() => true),
    processes: rows.map(({ pid, rssKiB, name }) => ({ pid, rssKiB, name })),
  }
}
export function peakMemory(samples) {
  return samples.reduce((peak, sample) => (sample.totalRssKiB > peak.totalRssKiB ? sample : peak), {
    totalRssKiB: 0,
    hostKiB: 0,
    webContentKiB: 0,
    webSupportKiB: 0,
  })
}
