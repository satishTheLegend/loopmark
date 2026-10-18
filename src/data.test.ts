import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCheckpoint,
  createProject,
  deleteProject,
  exportBackup,
  getLibraryRevision,
  listProjects,
  MAX_CHECKPOINTS,
  MAX_PROJECTS,
  parseBackup,
  restoreBackup,
  seedSamples,
  setProjectStatus,
  subscribe,
  updateProject,
} from './data'
import type { Backup, CheckpointInput, ProjectInput } from './types'

const projectInput: ProjectInput = {
  name: 'Moss stitch scarf',
  craft: 'Crochet',
  color: 'sage',
  yarn: 'Cotton DK',
  toolSize: '4 mm',
  notes: '',
}
const checkpointInput: CheckpointInput = {
  position: 'Row 24',
  toolSize: '4 mm',
  nextStep: 'Turn, chain one, then continue moss stitch.',
  notes: 'Keep a loose edge.',
}
const emptyBackup = (): Backup => ({
  format: 'loopmark',
  version: 1,
  exportedAt: new Date().toISOString(),
  projects: [],
})
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQmcAAAAASUVORK5CYII='
// Complete mono PCM WAV: 44-byte header followed by one 16-bit silent sample.
const wav = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA=='

beforeEach(async () => {
  vi.restoreAllMocks()
  await restoreBackup(emptyBackup())
})

describe('backup validation', () => {
  it('rejects date-range poisoning before replacing the library', async () => {
    const original = await createProject(projectInput)
    const backup = await exportBackup()
    backup.projects[0].updatedAt = '+275760-09-12T23:59:59.998Z'
    await expect(restoreBackup(backup)).rejects.toThrow('date')
    expect(await listProjects()).toEqual([original])
    await addCheckpoint(original.id, checkpointInput)
    await restoreBackup(emptyBackup())
    expect(await listProjects()).toEqual([])
  })

  it('recovers legacy poisoned clocks through an atomic valid-backup restore and retains supported revisions', async () => {
    const original = await createProject(projectInput)
    const backup = await exportBackup()
    const supported = await createProject({ ...projectInput, name: 'Supported clock' })
    const future = '2041-01-01T00:00:00.000Z'
    const poison = '+275760-09-13T00:00:00.000Z'
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('loopmark', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['projects', 'meta'], 'readwrite')
        tx.objectStore('projects').put({ ...original, updatedAt: poison })
        tx.objectStore('projects').put({ ...supported, updatedAt: future })
        const metadata = tx.objectStore('meta').get('library')
        metadata.onsuccess = () =>
          tx.objectStore('meta').put({ ...metadata.result, lastUpdatedAt: poison })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onabort = tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }
    })
    await expect(createProject(projectInput)).rejects.toThrow('supported range')
    const poisoned = await listProjects()
    const revision = await getLibraryRevision()
    const add = IDBObjectStore.prototype.add
    const failure = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'projects')
        throw new DOMException('Injected restore failure', 'QuotaExceededError')
      return add.call(this, value, key)
    })
    await expect(restoreBackup(backup, revision)).rejects.toThrow('storage is full')
    expect(await listProjects()).toEqual(poisoned)
    expect(await getLibraryRevision()).toBe(revision)
    failure.mockRestore()
    await restoreBackup(backup, revision)
    const restored = (await listProjects())[0]
    expect(restored.id).toBe(original.id)
    expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(future))
    await expect(updateProject(restored.id, projectInput, original.updatedAt)).rejects.toThrow(
      'another tab',
    )
    await createProject(projectInput)
    await addCheckpoint(restored.id, checkpointInput)
    expect(await listProjects()).toHaveLength(2)
  })

  it('rejects signature-only and truncated attachments without replacing good data', async () => {
    const original = await createProject(projectInput)
    const backup = await exportBackup()
    for (const media of [
      { photo: 'data:image/jpeg;base64,/9j/' },
      { photo: `data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n')}` },
      { voice: 'data:audio/webm;base64,GkXfow==' },
      { voice: wav.slice(0, -8) },
    ]) {
      backup.projects[0].checkpoints = [
        { ...checkpointInput, ...media, id: 'broken-media', createdAt: original.createdAt },
      ]
      await expect(restoreBackup(backup)).rejects.toThrow()
      expect(await listProjects()).toEqual([original])
    }
  })

  it('accepts recorder MIME parameters with optional whitespace', async () => {
    const project = await createProject(projectInput)
    await expect(
      addCheckpoint(project.id, {
        ...checkpointInput,
        voice: wav.replace(';base64', '; codecs=pcm; base64'),
      }),
    ).resolves.toBeDefined()
  })

  it('accepts native Firefox WebM with its empty SeekHead element', async () => {
    const project = await createProject(projectInput)
    const voice = readFileSync(new URL('./fixtures/firefox-recording.txt', import.meta.url), 'utf8')
    await expect(addCheckpoint(project.id, { ...checkpointInput, voice })).resolves.toBeDefined()
  })

  it('rejects malformed JSON, unsupported versions and missing fields without changing existing data', async () => {
    const project = await createProject(projectInput)
    expect(() => parseBackup('{')).toThrow('valid JSON')
    expect(() => parseBackup(JSON.stringify({ ...emptyBackup(), version: 2 }))).toThrow()
    const backup = await exportBackup()
    const malformed = JSON.parse(JSON.stringify(backup))
    delete malformed.projects[0].name
    await expect(restoreBackup(malformed)).rejects.toThrow()
    expect((await listProjects())[0].id).toBe(project.id)
  })

  it('rejects duplicate project/checkpoint IDs and project codes', async () => {
    const project = await createProject(projectInput)
    await addCheckpoint(project.id, checkpointInput)
    const backup = await exportBackup()
    const duplicate = structuredClone(backup.projects[0])
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, projects: [...backup.projects, duplicate] })),
    ).toThrow('unique')
    duplicate.id = 'another-project'
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, projects: [...backup.projects, duplicate] })),
    ).toThrow('unique')
    duplicate.code = 'LM-ANOTHER'
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, projects: [...backup.projects, duplicate] })),
    ).toThrow('unique')
  })

  it('rejects external, SVG, invalid base64 and mismatched media containers', async () => {
    const project = await createProject(projectInput)
    for (const photo of [
      'https://example.com/photo.jpg',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,not base64',
      'data:image/png;base64,YWJjZA==',
    ]) {
      await expect(addCheckpoint(project.id, { ...checkpointInput, photo })).rejects.toThrow(
        'Photo',
      )
    }
    expect((await listProjects())[0].checkpoints).toHaveLength(0)
  })

  it('rejects excessive fields, invalid dates and unknown properties', async () => {
    await expect(createProject({ ...projectInput, name: 'a'.repeat(101) })).rejects.toThrow()
    await createProject(projectInput)
    const backup = await exportBackup()
    backup.projects[0].createdAt = 'not a date'
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('Invalid date')
    expect(() => parseBackup(JSON.stringify({ ...emptyBackup(), unwanted: true }))).toThrow()
  })

  it('normalizes imported history so resume always presents the newest checkpoint', async () => {
    const project = await createProject(projectInput)
    const checkpoints = [
      {
        ...checkpointInput,
        id: 'older',
        createdAt: '2026-10-01T12:00:00.000Z',
        nextStep: 'Older instruction',
      },
      {
        ...checkpointInput,
        id: 'newer',
        createdAt: '2026-10-18T12:00:00.000Z',
        nextStep: 'Continue here',
      },
    ]
    const parsed = parseBackup(
      JSON.stringify({ ...emptyBackup(), projects: [{ ...project, checkpoints }] }),
    )
    expect(parsed.projects[0].checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      'newer',
      'older',
    ])
    await restoreBackup(parsed)
    expect((await listProjects())[0].checkpoints[0].nextStep).toBe('Continue here')
  })
})

describe('transactional project storage', () => {
  it('commits repeated and concurrent create retries only once per draft operation', async () => {
    const projects = await Promise.all([
      createProject(projectInput, 'create-draft-revision'),
      createProject(projectInput, 'create-draft-revision'),
    ])
    expect(projects[0].id).toBe(projects[1].id)
    expect((await createProject(projectInput, 'create-draft-revision')).id).toBe(projects[0].id)
    expect(await listProjects()).toHaveLength(1)
  })

  it('commits repeated and concurrent checkpoint retries only once per draft operation', async () => {
    const project = await createProject(projectInput)
    await Promise.all([
      addCheckpoint(project.id, checkpointInput, 'checkpoint-draft-revision'),
      addCheckpoint(project.id, checkpointInput, 'checkpoint-draft-revision'),
    ])
    await addCheckpoint(project.id, checkpointInput, 'checkpoint-draft-revision')
    expect((await listProjects())[0].checkpoints).toHaveLength(1)
  })

  it('clears committed-operation receipts when deleting or replacing their collection', async () => {
    const project = await createProject(projectInput, 'reusable-token')
    await deleteProject(project.id, project.updatedAt)
    const recreated = await createProject(projectInput, 'reusable-token')
    expect(recreated.id).not.toBe(project.id)
    await restoreBackup(emptyBackup())
    const restored = await createProject(projectInput, 'reusable-token')
    expect(restored.id).not.toBe(recreated.id)
    expect(await listProjects()).toHaveLength(1)
  })

  it('rejects replaying a committed save token with different input or project', async () => {
    const first = await createProject(projectInput, 'create-bound-input')
    await expect(
      createProject({ ...projectInput, name: 'Different' }, 'create-bound-input'),
    ).rejects.toThrow('different input')
    const second = await createProject(projectInput)
    await addCheckpoint(first.id, checkpointInput, 'checkpoint-bound-input')
    await expect(
      addCheckpoint(
        first.id,
        { ...checkpointInput, nextStep: 'Changed' },
        'checkpoint-bound-input',
      ),
    ).rejects.toThrow('different input')
    await expect(
      addCheckpoint(second.id, checkpointInput, 'checkpoint-bound-input'),
    ).rejects.toThrow('different input')
    expect(
      (await listProjects()).reduce((count, project) => count + project.checkpoints.length, 0),
    ).toBe(1)
  })

  it('rolls back the saved record and receipt together when receipt persistence fails', async () => {
    const revision = await getLibraryRevision()
    const put = IDBObjectStore.prototype.put
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'meta' && String((value as { key?: string }).key).startsWith('receipt:'))
        throw new DOMException('Injected receipt failure', 'QuotaExceededError')
      return put.call(this, value, key)
    })
    await expect(createProject(projectInput, 'failed-receipt')).rejects.toThrow('storage is full')
    expect(await listProjects()).toEqual([])
    expect(await getLibraryRevision()).toBe(revision)
    failure.mockRestore()
    const created = await createProject(projectInput, 'failed-receipt')
    expect((await createProject(projectInput, 'failed-receipt')).id).toBe(created.id)
    expect(await listProjects()).toHaveLength(1)
  })
  it('preserves both concurrent checkpoint appends and immutable snapshots', async () => {
    const project = await createProject(projectInput)
    await Promise.all([
      addCheckpoint(project.id, { ...checkpointInput, position: 'Row 24' }),
      addCheckpoint(project.id, { ...checkpointInput, position: 'Row 25', toolSize: '4.5 mm' }),
    ])
    const saved = (await listProjects())[0]
    expect(saved.checkpoints).toHaveLength(2)
    expect(new Set(saved.checkpoints.map((checkpoint) => checkpoint.position))).toEqual(
      new Set(['Row 24', 'Row 25']),
    )
    expect(saved.checkpoints.find((checkpoint) => checkpoint.position === 'Row 24')?.toolSize).toBe(
      '4 mm',
    )
  })

  it('rejects stale metadata edits, status changes and deletion', async () => {
    const original = await createProject(projectInput)
    const changed = await updateProject(
      original.id,
      { ...projectInput, name: 'Updated scarf' },
      original.updatedAt,
    )
    expect(changed.updatedAt).not.toBe(original.updatedAt)
    await expect(updateProject(original.id, projectInput, original.updatedAt)).rejects.toThrow(
      'another tab',
    )
    await expect(setProjectStatus(original.id, 'finished', original.updatedAt)).rejects.toThrow(
      'another tab',
    )
    await expect(deleteProject(original.id, original.updatedAt)).rejects.toThrow('another tab')
    expect((await listProjects())[0].name).toBe('Updated scarf')
  })

  it('advances concurrency tokens even when the clock does not advance', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T12:00:00.000Z'))
    const first = await createProject(projectInput)
    const second = await setProjectStatus(first.id, 'finished', first.updatedAt)
    const third = await setProjectStatus(first.id, 'active', second.updatedAt)
    expect(first.updatedAt < second.updatedAt && second.updatedAt < third.updatedAt).toBe(true)
  })

  it('does not recreate deleted records from stale tabs', async () => {
    const project = await createProject(projectInput)
    await deleteProject(project.id, project.updatedAt)
    await expect(addCheckpoint(project.id, checkpointInput)).rejects.toThrow('no longer')
    expect(await listProjects()).toEqual([])
  })

  it('rejects checkpoint capture when another tab finishes first, and permits it after reopening', async () => {
    const project = await createProject(projectInput)
    const [finished, checkpoint] = await Promise.allSettled([
      setProjectStatus(project.id, 'finished', project.updatedAt),
      addCheckpoint(project.id, checkpointInput),
    ])
    expect(finished.status).toBe('fulfilled')
    expect(checkpoint.status).toBe('rejected')
    if (checkpoint.status === 'rejected') expect(checkpoint.reason.message).toContain('Reopen it')
    const stored = (await listProjects())[0]
    expect(stored.status).toBe('finished')
    expect(stored.checkpoints).toHaveLength(0)
    await setProjectStatus(stored.id, 'active', stored.updatedAt)
    expect((await addCheckpoint(stored.id, checkpointInput)).checkpoints).toHaveLength(1)
  })

  it('never replaces a project created concurrently before sample seeding', async () => {
    const template = await createProject(projectInput)
    const samples = { ...emptyBackup(), projects: [{ ...template, sample: true }] }
    await restoreBackup(emptyBackup())
    const [created, seeded] = await Promise.allSettled([
      createProject({ ...projectInput, name: 'My real project' }),
      seedSamples(samples),
    ])
    expect(created.status).toBe('fulfilled')
    expect(seeded.status).toBe('rejected')
    if (seeded.status === 'rejected') expect(seeded.reason.message).toContain('empty collection')
    expect((await listProjects()).map((project) => project.name)).toEqual(['My real project'])
  })

  it('preserves both samples and a real project when seeding commits first', async () => {
    const template = await createProject(projectInput)
    const samples = { ...emptyBackup(), projects: [{ ...template, sample: true }] }
    await restoreBackup(emptyBackup())
    await Promise.all([
      seedSamples(samples),
      createProject({ ...projectInput, name: 'My real project' }),
    ])
    const projects = await listProjects()
    expect(projects).toHaveLength(2)
    expect(projects.filter((project) => project.sample)).toHaveLength(1)
    expect(projects.some((project) => project.name === 'My real project')).toBe(true)
  })

  it('allows only one of two simultaneous sample-seeding attempts', async () => {
    const template = await createProject(projectInput)
    const samples = { ...emptyBackup(), projects: [{ ...template, sample: true }] }
    await restoreBackup(emptyBackup())
    const results = await Promise.allSettled([seedSamples(samples), seedSamples(samples)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await listProjects()).toHaveLength(1)
  })

  it('enforces project capacity atomically and frees capacity after deletion', async () => {
    const template = await createProject(projectInput)
    const projects = Array.from({ length: MAX_PROJECTS }, (_, index) => ({
      ...template,
      id: `project-${index}`,
      code: `LM-${index.toString().padStart(4, '0')}`,
    }))
    await restoreBackup({ ...emptyBackup(), projects })
    await expect(createProject(projectInput)).rejects.toThrow(`${MAX_PROJECTS} projects`)
    const saved = await listProjects()
    expect(saved).toHaveLength(MAX_PROJECTS)
    await deleteProject(saved[0].id, saved[0].updatedAt)
    await createProject(projectInput)
    expect(await listProjects()).toHaveLength(MAX_PROJECTS)
  })

  it('enforces the checkpoint budget without dropping existing history', async () => {
    const template = await createProject(projectInput)
    const checkpoints = Array.from({ length: MAX_CHECKPOINTS }, (_, index) => ({
      ...checkpointInput,
      id: `checkpoint-${index}`,
      createdAt: template.updatedAt,
    }))
    await restoreBackup({ ...emptyBackup(), projects: [{ ...template, checkpoints }] })
    await expect(addCheckpoint(template.id, checkpointInput)).rejects.toThrow(
      `${MAX_CHECKPOINTS} checkpoints`,
    )
    expect((await listProjects())[0].checkpoints).toHaveLength(MAX_CHECKPOINTS)
    expect(parseBackup(JSON.stringify(await exportBackup())).projects[0].checkpoints).toHaveLength(
      MAX_CHECKPOINTS,
    )
  })

  it('round-trips every project field, photo and voice in a self-contained backup', async () => {
    const project = await createProject(projectInput)
    await addCheckpoint(project.id, { ...checkpointInput, photo: png, voice: wav })
    const backup = await exportBackup()
    const parsed = parseBackup(JSON.stringify(backup))
    await restoreBackup(emptyBackup())
    await restoreBackup(parsed)
    const restored = (await exportBackup()).projects
    expect(restored.map(({ updatedAt: _updatedAt, ...project }) => project)).toEqual(
      backup.projects.map(({ updatedAt: _updatedAt, ...project }) => project),
    )
    expect(restored[0].updatedAt > backup.projects[0].updatedAt).toBe(true)
  })

  it('invalidates a form opened before a restore of the same record', async () => {
    const original = await createProject(projectInput)
    const backup = await exportBackup()
    await restoreBackup(backup)
    await expect(
      updateProject(original.id, { ...projectInput, name: 'Stale form' }, original.updatedAt),
    ).rejects.toThrow('another tab')
    expect((await listProjects())[0].name).toBe(projectInput.name)
  })

  it('rejects a restore when the library changed after preview and permits a refreshed confirmation', async () => {
    const project = await createProject(projectInput)
    const previewRevision = await getLibraryRevision()
    const pending = emptyBackup()
    await addCheckpoint(project.id, checkpointInput)
    const latest = await listProjects()
    await expect(restoreBackup(pending, previewRevision)).rejects.toThrow('changed')
    expect(await listProjects()).toEqual(latest)
    await restoreBackup(pending, await getLibraryRevision())
    expect(await listProjects()).toEqual([])
  })

  it('changes the library revision for every successful mutation, including an empty restore', async () => {
    const before = await getLibraryRevision()
    await restoreBackup(emptyBackup(), before)
    const after = await getLibraryRevision()
    expect(after).not.toBe(before)
    await expect(restoreBackup(emptyBackup(), before)).rejects.toThrow('changed')
  })

  it('advances a restored token beyond existing, incoming and checkpoint dates even after a clock rollback', async () => {
    const template = await createProject(projectInput)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00.000Z'))
    await restoreBackup({
      ...emptyBackup(),
      projects: [{ ...template, updatedAt: '2030-01-01T00:00:00.000Z' }],
    })
    const existing = (await listProjects())[0]
    await restoreBackup({
      ...emptyBackup(),
      projects: [{ ...template, updatedAt: '2025-01-01T00:00:00.000Z' }],
    })
    const restoredOlder = (await listProjects())[0]
    expect(Date.parse(restoredOlder.updatedAt)).toBeGreaterThan(Date.parse(existing.updatedAt))
    await expect(updateProject(existing.id, projectInput, existing.updatedAt)).rejects.toThrow(
      'another tab',
    )
    await restoreBackup({
      ...emptyBackup(),
      projects: [
        {
          ...template,
          updatedAt: '2040-01-01T00:00:00.000Z',
          checkpoints: [
            { ...checkpointInput, id: 'future-checkpoint', createdAt: '2041-01-01T00:00:00.000Z' },
          ],
        },
      ],
    })
    const restoredNewer = (await listProjects())[0]
    expect(Date.parse(restoredNewer.updatedAt)).toBeGreaterThan(
      Date.parse('2041-01-01T00:00:00.000Z'),
    )
    const appended = await addCheckpoint(template.id, checkpointInput)
    expect(Date.parse(appended.checkpoints[0].createdAt)).toBeGreaterThan(
      Date.parse(appended.checkpoints[1].createdAt),
    )
  })

  it('keeps a token watermark when records are removed and an older backup reintroduces their IDs', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00.000Z'))
    const original = await createProject(projectInput)
    const oldBackup = await exportBackup()
    const openForm = await updateProject(
      original.id,
      { ...projectInput, name: 'Latest edit' },
      original.updatedAt,
    )
    await restoreBackup(emptyBackup())
    await restoreBackup(oldBackup)
    const restored = (await listProjects())[0]
    expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(openForm.updatedAt))
    await expect(
      updateProject(
        original.id,
        { ...projectInput, name: 'Stale restored form' },
        openForm.updatedAt,
      ),
    ).rejects.toThrow('another tab')
  })

  it('rolls back clear and partial writes when restore fails in the transaction', async () => {
    const original = await createProject(projectInput)
    const replacement: Backup = {
      ...emptyBackup(),
      projects: [
        { ...original, id: 'replacement-one', code: 'LM-ONE' },
        { ...original, id: 'replacement-two', code: 'LM-TWO' },
      ],
    }
    const add = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'projects' && (value as { id?: string }).id === 'replacement-two')
        throw new DOMException('Injected storage failure', 'QuotaExceededError')
      return add.call(this, value, key)
    })
    await expect(restoreBackup(replacement)).rejects.toThrow('storage is full')
    expect(await listProjects()).toEqual([original])
  })

  it('notifies subscribers only after committed mutations, and unsubscribes', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    const project = await createProject(projectInput)
    expect(listener).toHaveBeenCalledTimes(1)
    await expect(updateProject(project.id, projectInput, 'stale')).rejects.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    await addCheckpoint(project.id, checkpointInput)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
