import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'

// Real service-worker lifecycle tests on a disposable local origin and production files.
async function fixture() {
  const state = { failAsset: false, generation: 1 }
  const root = resolve('dist')
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, 'http://localhost').pathname
      if (state.failAsset && pathname === '/icon-512.png') {
        response.writeHead(503)
        response.end('Fixture unavailable')
        return
      }
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!path.startsWith(root + '/')) {
        response.writeHead(403)
        response.end()
        return
      }
      let bytes: string | Buffer = await readFile(path)
      if (pathname === '/sw.js')
        bytes = bytes
          .toString()
          .replace(/const CACHE='([^']+)';/, `const CACHE='$1-test-${state.generation}';`)
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.webmanifest': 'application/manifest+json',
      }
      response.writeHead(200, {
        'Content-Type': types[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(bytes)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address() as { port: number }
  return {
    state,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

test('failed precache is reported and a deliberate retry prepares offline reopening', async ({
  page,
  context,
}) => {
  const server = await fixture()
  try {
    server.state.failAsset = true
    await page.goto(server.url + '/#guide')
    await expect(page.getByText(/Offline installation failed/)).toBeVisible()
    await expect(page.getByText('Ready offline on this device.', { exact: true })).toHaveCount(0)
    server.state.failAsset = false
    await page.getByRole('button', { name: 'Check offline readiness & updates' }).click()
    await expect(page.getByText('Ready offline on this device.', { exact: true })).toBeVisible()
    await context.setOffline(true)
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Leave a note. Find your rhythm.' }),
    ).toBeVisible()
    await expect(page.getByText('Ready offline on this device.', { exact: true })).toBeVisible()
  } finally {
    await context.setOffline(false)
    await server.close()
  }
})

test('missing cached files are detected and repaired without deleting projects', async ({
  page,
}) => {
  const server = await fixture()
  try {
    await page.goto(server.url + '/#guide')
    await expect(page.getByText('Ready offline on this device.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add a project', exact: true }).click()
    await page.getByLabel('Project name').fill('Offline keeper')
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Offline keeper', exact: true })).toBeVisible()
    const projectUrl = page.url()
    await page.goto(server.url + '/#guide')
    await expect(page.getByText('Ready offline on this device.', { exact: true })).toBeVisible()
    await page.evaluate(async () => {
      for (const key of await caches.keys())
        await (await caches.open(key)).delete('/art/clay-scarf.svg')
    })
    await page.getByRole('button', { name: 'Check offline readiness & updates' }).click()
    await expect(page.getByText(/Offline files are incomplete/)).toBeVisible()
    await page.getByRole('button', { name: 'Check offline readiness & updates' }).click()
    await expect(page.getByText('Ready offline on this device.', { exact: true })).toBeVisible()
    await page.goto(projectUrl)
    await expect(page.getByRole('heading', { name: 'Offline keeper', exact: true })).toBeVisible()
  } finally {
    await server.close()
  }
})

test('a waiting update keeps an open draft intact and activates after all old tabs close', async ({
  page,
  context,
}) => {
  const server = await fixture()
  try {
    await page.goto(server.url + '/#guide')
    await expect(page.getByText('Ready offline on this device.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add a project', exact: true }).click()
    await page.getByLabel('Project name').fill('Waiting for an update')
    await expect(page.getByText('Draft kept on this device.', { exact: false })).toBeVisible()
    server.state.generation = 2
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update()
    })
    await expect(page.getByText(/An update is ready/)).toBeAttached()
    await expect(page.getByLabel('Project name')).toHaveValue('Waiting for an update')
    await page.close()
    const next = await context.newPage()
    await next.goto(server.url + '/#guide')
    await expect(next.getByText('Ready offline on this device.', { exact: true })).toBeVisible()
    await expect
      .poll(async () =>
        next.evaluate(
          async () =>
            (await caches.keys()).some((key) => key.endsWith('test-2')) &&
            !(await caches.keys()).some((key) => key.endsWith('test-1')),
        ),
      )
      .toBe(true)
    await next.getByRole('button', { name: 'Add a project', exact: true }).click()
    await expect(next.getByLabel('Project name')).toHaveValue('Waiting for an update')
  } finally {
    await server.close()
  }
})
