import { expect, it, vi } from 'vitest'
import { createPortableDraftStore, type ReferencedDraftStore } from './portable-draft-store'
import type { DraftRecord } from '../repositories/drafts'
import type { PlatformMedia } from '../platform/contracts'
import { canonicalJson } from '../domain/canonical-json'
import { png } from '../repositories/browser/fixtures.test-support'
it('normalizes the actual initial text-only checkpoint form for strict SQLite JSON and preserves valid media references', async () => {
  let saved: DraftRecord<unknown> | undefined, bytes: Blob | undefined
  const storage: ReferencedDraftStore = {
    read: async <T>() => saved as DraftRecord<T> | undefined,
    write: async (_key, _previous, draft) => {
      if (draft) canonicalJson(draft.value)
      saved = structuredClone(draft)
    },
    removeProjectDrafts: async () => {},
  }
  const media: PlatformMedia = {
    prepare: async () => {
      throw new Error('unused')
    },
    storeVerified: vi.fn(async (_ref, blob) => {
      bytes = blob
    }),
    open: async () => bytes!.stream(),
    release: async () => {},
  }
  const drafts = createPortableDraftStore(storage, media, {
    key: { namespace: 'local', collectionId: 'personal', epoch: 'initial' },
    generation: 0,
    device: { id: 'device', generation: 'gen' },
  })
  const form = {
    toolSize: '4 mm',
    position: '',
    nextStep: '',
    notes: '',
    photo: undefined,
    voice: undefined,
  }
  await drafts.write('checkpoint:project', undefined, {
    key: 'checkpoint:project',
    revision: 'one',
    value: form,
  })
  expect(saved?.value).toEqual({ toolSize: '4 mm', position: '', nextStep: '', notes: '' })
  expect(media.storeVerified).not.toHaveBeenCalled()
  await drafts.write('checkpoint:project', 'one', {
    key: 'checkpoint:project',
    revision: 'two',
    value: { ...form, photo: png },
  })
  expect((saved?.value as { photo: unknown }).photo).toMatchObject({
    kind: 'photo',
    mimeType: 'image/png',
  })
  expect((await drafts.read<{ photo: string }>('checkpoint:project'))?.value.photo).toBe(png)
})
