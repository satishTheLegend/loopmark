import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { parseProjectLink, projectLink, resolveProjectLink } from './link-service'
import { openBrowserRepository } from '../repositories/browser/repository'
import { create, info } from '../repositories/browser/fixtures.test-support'
it('accepts only configured private project routes and legacy project labels', () => {
  expect(parseProjectLink('https://craft.example/p/abc_12', 'https://craft.example')).toEqual({
    kind: 'project',
    projectId: 'abc_12',
  })
  expect(
    parseProjectLink('https://craft.example/#project=abc-12', 'https://craft.example'),
  ).toEqual({ kind: 'legacy', projectId: 'abc-12' })
  expect(projectLink('abc', 'https://craft.example')).toBe('https://craft.example/p/abc')
  for (const path of [
    'https://evil.example/p/abc',
    'https://craft.example/p/a%2Fb',
    'https://craft.example/p/%00',
    'https://craft.example/p/abc?next=https://evil.example',
    'https://craft.example/p/abc#token',
    'https://craft.example/?project=abc',
    'https://craft.example/#project=%E0%A4%A',
  ])
    expect(() => parseProjectLink(path, 'https://craft.example')).toThrow()
})
it('opens cached own work offline but never searches another account namespace for a matching ID', async () => {
  const repo = await openBrowserRepository({ factory: new IDBFactory(), databaseName: 'links' })
  try {
    const own = info(true),
      guest = info(false, 'guest')
    await repo.createCollection(own)
    await repo.createCollection(guest)
    const scope = { key: own.key, generation: 1, device: { id: 'device', generation: 'gen' } }
    await repo.activate(scope)
    await repo.commitLocal(own.key, create(), 1)
    const target = { kind: 'project' as const, projectId: 'project' },
      signal = new AbortController().signal
    expect(
      (await resolveProjectLink({ target, scope, accountId: 'account', repository: repo, signal }))
        .name,
    ).toBe('Moss scarf')
    await expect(
      resolveProjectLink({ target, scope, accountId: 'other', repository: repo, signal }),
    ).rejects.toMatchObject({ detail: { code: 'NOT_AVAILABLE' } })
    const next = await repo.transition(scope, { key: guest.key, device: scope.device })
    await expect(
      resolveProjectLink({ target, scope: next, accountId: 'account', repository: repo, signal }),
    ).rejects.toMatchObject({ detail: { code: 'NOT_AVAILABLE' } })
    await expect(
      resolveProjectLink({ target, scope, accountId: 'account', repository: repo, signal }),
    ).rejects.toMatchObject({ detail: { code: 'ACCOUNT_CHANGED' } })
  } finally {
    await repo.close()
  }
})
