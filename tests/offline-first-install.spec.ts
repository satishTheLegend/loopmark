import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

// Real production service worker. The two lifecycle gates keep its first installation
// between pointerdown and pointerup, instead of depending on a lucky scheduling race.
async function firstInstallFixture() {
  let install!: () => void, activate!: () => void
  const installed = new Promise<void>((done) => {
    install = done
  })
  const activated = new Promise<void>((done) => {
    activate = done
  })
  const state = { installing: false, activating: false }
  const root = resolve('dist')
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, 'http://localhost').pathname
      if (pathname === '/__first-install') {
        state.installing = true
        await installed
        response.writeHead(204).end()
        return
      }
      if (pathname === '/__first-activation') {
        state.activating = true
        await activated
        response.writeHead(204).end()
        return
      }
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!path.startsWith(root + '/')) {
        response.writeHead(403).end()
        return
      }
      let bytes: string | Buffer = await readFile(path)
      if (pathname === '/sw.js') {
        // Hold the worker's existing activation chain before clients.claim() as well:
        // a controllerchange would otherwise clear the brief installed-state banner.
        const source = bytes.toString()
        if (!source.includes('.then(()=>self.clients.claim())'))
          throw new Error('The production service-worker activation chain changed')
        bytes = `${source.replace(
          '.then(()=>self.clients.claim())',
          ".then(()=>fetch('/__first-activation')).then(()=>self.clients.claim())",
        )}
self.addEventListener('install', event => event.waitUntil(fetch('/__first-install')));
`
      }
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.json': 'application/json',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.webmanifest': 'application/manifest+json',
      }
      response
        .writeHead(200, {
          'Content-Type': types[extname(path)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        .end(bytes)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return {
    state,
    install,
    activate,
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    async close() {
      install()
      activate()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

test('first offline installation never inserts an update banner between pointerdown and pointerup', async ({
  page,
}, testInfo) => {
  const fixture = await firstInstallFixture()
  try {
    await page.addInitScript(() => {
      const events: unknown[] = []
      Object.assign(window, { firstInstallEvents: events })
      for (const type of ['pointerdown', 'pointerup', 'click'])
        document.addEventListener(
          type,
          (event) =>
            events.push({
              type,
              target: (event.target as Element).tagName,
              text: (event.target as Element).textContent?.trim(),
            }),
          true,
        )
      new MutationObserver((rows) => {
        for (const row of rows)
          for (const node of row.addedNodes)
            if (node instanceof Element && node.matches('.offline-banner'))
              events.push({ type: 'banner', text: node.textContent })
      }).observe(document, { childList: true, subtree: true })
    })
    await page.goto(fixture.origin)
    const button = page.getByRole('button', { name: 'New project', exact: true })
    await expect(button).toBeVisible()
    await expect.poll(() => fixture.state.installing).toBe(true)
    const before = (await button.boundingBox())!
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.mouse.down()
    fixture.install()
    await expect.poll(() => fixture.state.activating).toBe(true)
    // Flush the installed-state React render before the physical pointer release.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    )
    const during = (await button.boundingBox())!
    await page.mouse.up()
    const events = await page.evaluate(
      () => (window as unknown as { firstInstallEvents: unknown[] }).firstInstallEvents,
    )
    await testInfo.attach('first-install-pointer-events', {
      contentType: 'application/json',
      body: JSON.stringify({ before, during, events }, null, 2),
    })
    await expect(page.getByLabel('Project name')).toBeVisible()
    expect(events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'banner' })]),
    )
    expect(Math.abs(during.y - before.y)).toBeLessThan(2)
    fixture.activate()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.getByLabel('Project name').fill('First installation preserved my click')
    await expect(page.getByLabel('Project name')).toHaveValue(
      'First installation preserved my click',
    )
  } finally {
    await page.mouse.up()
    await fixture.close()
  }
})
