import test from 'node:test'
import assert from 'node:assert/strict'
import { iosMemory, androidMemory, peakMemory } from '../../scripts/native/benchmark-memory.mjs'
test('iOS RSS includes only the selected simulator parent and app, separating content and support', () => {
  const result = iosMemory(
    `PID PPID RSS COMM\n12 8 10 /sim/App.app/App\n13 8 20 /Library/Developer/CoreSimulator/test/com.apple.WebKit.WebContent\n14 8 5 /Library/Developer/CoreSimulator/test/com.apple.WebKit.GPU\n15 9 999 /Library/Developer/CoreSimulator/test/com.apple.WebKit.WebContent\n16 8 999 /Caches/Playwright/com.apple.WebKit.WebContent`,
    12,
    8,
  )
  assert.deepEqual(
    [result.hostKiB, result.webContentKiB, result.webSupportKiB, result.totalRssKiB],
    [10, 20, 5, 35],
  )
})
test('Android RSS keeps benchmark and isolated WebView renderer, ignoring unrelated app/browser', () => {
  const result = androidMemory(
    `PID PPID RSS NAME ARGS\n1 4 30 app.loopmark.craft.benchmark app.loopmark.craft.benchmark\n2 4 40 sandboxed_process com.google.android.webview:sandboxed_process0:service\n3 4 999 chrome com.android.chrome\n4 1 999 zygote webview_zygote`,
    'app.loopmark.craft.benchmark',
  )
  assert.equal(result.hostKiB, 30)
  assert.equal(result.webContentKiB, 40)
  assert.equal(result.totalRssKiB, 70)
  assert.equal(peakMemory([result, { totalRssKiB: 12 }]).totalRssKiB, 70)
})
