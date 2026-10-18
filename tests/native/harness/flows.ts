import { CapacitorAudioRecorder } from '@capgo/capacitor-audio-recorder'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { createNativeWorkflowStore } from '../../../src/platform/native/workflow-store'
import { createNativeDeviceStore } from '../../../src/platform/native/device-store'
import {
  subscribeNativeLifecycle,
  type NativeLifecycleEvent,
} from '../../../src/platform/native/lifecycle'
import { NativeCamera, normalizeNativePhoto } from '../../../src/platform/native/camera'
import { NativeShare } from '../../../src/platform/native/share'
import { NativeAudio } from '../../../src/platform/native/audio'
import { NativeCaptureRecovery } from '../../../src/platform/native/capture-recovery'
import { Purchases } from '@revenuecat/purchases-capacitor'
import { createNativeBilling } from '../../../src/platform/native/purchases'
import { openNativeRepository } from '../../../src/platform/native/repository'
import { fixture } from './persistence'
import type { BoundaryResult } from '../../../src/domain/contracts'
import { createTabLease } from '../../../src/sync/tab-lease'
const assert = (value: unknown) => {
  if (!value) throw new Error('Assertion failed')
}
export async function capabilityTests(
  test: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  await test('native durable workflow CAS and scope fences preserve deletion continuation across local removal', async () => {
    const info = fixture(),
      name = `workflow_${Date.now()}`
    let repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    const scope = await repo.transition(null, {
      key: info.key,
      device: { id: 'workflow-device', generation: 'workflow-generation' },
    })
    let store = createNativeWorkflowStore(repo)
    const entry = {
      kind: 'candidate' as const,
      accountId: 'account-a',
      collection: info.key,
      value: { snapshotId: 'snapshot-fixture' },
    }
    const row = await store.write('candidate', null, entry, scope)
    await store.write('deletion', null, {
      kind: 'deletion',
      accountId: 'account-a',
      collection: null,
      value: { receipt: 'synthetic-receipt' },
    })
    const competing = await Promise.allSettled([
      store.write('candidate', row.revision, { ...entry, value: { snapshotId: 'first' } }, scope),
      store.write('candidate', row.revision, { ...entry, value: { snapshotId: 'second' } }, scope),
    ])
    assert(competing.filter((result) => result.status === 'fulfilled').length === 1)
    const saved = (await store.read('candidate'))!
    let rejected = false
    try {
      await store.write('candidate', saved.revision, { ...entry, accountId: 'different' }, scope)
    } catch {
      rejected = true
    }
    assert(rejected)
    await repo.close()
    repo = await openNativeRepository({ databaseName: name })
    store = createNativeWorkflowStore(repo)
    assert((await store.read('candidate'))?.revision === saved.revision)
    assert((await store.list('candidate')).length === 1)
    const next = await repo.transition(scope, { key: info.key, device: scope.device })
    rejected = false
    try {
      await store.remove('candidate', saved.revision, scope)
    } catch {
      rejected = true
    }
    assert(rejected && (await store.read('candidate'))?.revision === saved.revision)
    let protectedCandidate = await store.write(
      'protected-candidate',
      null,
      { ...entry, value: { phase: 'queued' } },
      next,
    )
    rejected = false
    try {
      await repo.removeLocal(info.key, (await repo.readView(info.key)).revision, next.generation)
    } catch {
      rejected = true
    }
    assert(
      rejected &&
        (await store.read('protected-candidate'))?.revision === protectedCandidate.revision,
    )
    protectedCandidate = await store.write(
      protectedCandidate.id,
      protectedCandidate.revision,
      { ...entry, value: { phase: 'cancelled' } },
      next,
    )
    await store.write('candidate', saved.revision, { ...entry, value: { phase: 'complete' } }, next)
    await repo.removeLocal(info.key, (await repo.readView(info.key)).revision, next.generation)
    assert(
      (await store.read('candidate')) === null &&
        (await store.read('deletion'))?.kind === 'deletion',
    )
    await store.remove('deletion', (await store.read('deletion'))!.revision)
    await repo.close()
  })
  await test('native billing remains unconfigured without an authenticated enrolled account', async () => {
    assert(!(await Purchases.isConfigured()).isConfigured)
    const billing = createNativeBilling({
      current: () => null,
      loadConfig: async () => {
        throw new Error('Unexpected config access')
      },
    })
    assert((await billing.restore()).status === 'unavailable')
    assert(!(await Purchases.isConfigured()).isConfigured)
  })
  await test('native restored-camera staging survives reopen and applies only to its original draft revision', async () => {
    const info = fixture(),
      name = `capture_${Date.now()}`
    let repo = await openNativeRepository({ databaseName: name })
    await repo.createCollection(info)
    let scope = await repo.transition(null, {
      key: info.key,
      device: { id: 'capture-device', generation: 'capture-generation' },
    })
    const draft = await repo.drafts.save(
      'checkpoint:source',
      info.key,
      scope.generation,
      { nextStep: 'Original instruction' },
      [],
      null,
    )
    let recovery = new NativeCaptureRecovery(repo)
    const source = { scope, draftKey: draft.id, draftRevision: draft.revision }
    const id = await recovery.begin(source)
    await repo.close()
    repo = await openNativeRepository({ databaseName: name })
    recovery = new NativeCaptureRecovery(repo)
    assert((await recovery.pending(scope))?.state === 'waiting')
    const canvas = document.createElement('canvas')
    canvas.width = 10
    canvas.height = 10
    canvas.getContext('2d')!.fillRect(0, 0, 10, 10)
    // Injects the documented callback into the actual SQLite/file implementation; not OS process-death evidence.
    await recovery.restore({
      pluginId: 'Camera',
      methodName: 'getPhoto',
      success: true,
      data: { format: 'png', base64String: canvas.toDataURL('image/png').split(',')[1] },
    })
    scope = await repo.transition(scope, { key: scope.key, device: scope.device })
    assert((await recovery.pending(scope))?.state === 'ready')
    assert((await recovery.photo(id, scope)).bytes.type === 'image/jpeg')
    await repo.database.serial((db) =>
      db.execute(
        "CREATE TEMP TRIGGER fail_capture_draft BEFORE UPDATE ON metadata WHEN NEW.key LIKE 'draft:%' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
      ),
    )
    let failed = false
    try {
      await recovery.applyToDraft(id, scope)
    } catch {
      failed = true
    }
    assert(failed && (await recovery.pending(scope))?.state === 'ready')
    assert((await repo.drafts.read(draft.id, scope.key))?.revision === draft.revision)
    await repo.database.serial((db) => db.execute('DROP TRIGGER fail_capture_draft;'))
    const applied = await recovery.applyToDraft(id, scope)
    assert(applied.revision !== draft.revision && (await recovery.pending(scope)) === null)
    const saved = await repo.drafts.read(draft.id, scope.key)
    assert(
      saved?.media[0].kind === 'photo' &&
        (saved.value as { nextStep: string }).nextStep === 'Original instruction',
    )
    await recovery.begin({ scope, draftKey: draft.id, draftRevision: applied.revision })
    await recovery.restore({
      pluginId: 'Camera',
      methodName: 'getPhoto',
      success: true,
      data: { format: 'png', base64String: canvas.toDataURL('image/png').split(',')[1] },
    })
    const nextId = (await recovery.pending(scope))!.id
    await repo.drafts.save(
      draft.id,
      scope.key,
      scope.generation,
      { nextStep: 'Newer edit' },
      [],
      applied.revision,
    )
    failed = false
    try {
      await recovery.applyToDraft(nextId, scope)
    } catch {
      failed = true
    }
    assert(failed && (await recovery.pending(scope))?.state === 'ready')
    await recovery.acknowledge(nextId, scope)
    const currentDraft = (await repo.drafts.read(draft.id, scope.key))!
    const retainedId = await recovery.begin({
      scope,
      draftKey: draft.id,
      draftRevision: currentDraft.revision,
    })
    await recovery.restore({
      pluginId: 'Camera',
      methodName: 'getPhoto',
      success: true,
      data: { format: 'png', base64String: canvas.toDataURL('image/png').split(',')[1] },
    })
    const review = await repo.reviewLocal(scope.key)
    assert(review.drafts.some((item) => item.key === `native-camera:${retainedId}`))
    const retained = await repo.retainLocal(
      scope.key,
      'Keep camera recovery',
      review.revision,
      scope.generation,
    )
    await repo.removeLocal(scope.key, review.revision, scope.generation)
    scope = await repo.transition(scope, {
      key: retained,
      device: { id: 'local-device', generation: 'local-generation' },
    })
    assert((await recovery.pending(scope))?.id === retainedId)
    await recovery.applyToDraft(retainedId, scope)
    assert((await repo.drafts.read(draft.id, scope.key))?.media[0].kind === 'photo')
    await repo.close()
  })
  await test('native per-account device identity and verified offline label persist and clear', async () => {
    const name = `device_${Date.now()}`,
      info = fixture(true)
    let repo = await openNativeRepository({ databaseName: name }),
      devices = createNativeDeviceStore(repo)
    const first = await devices.read('account-a'),
      other = await devices.read('account-b')
    assert(first.id !== other.id && first.id === (await devices.read('account-a')).id)
    await devices.write('account-a', { ...first, generation: 'registered-generation' })
    const cached = {
      session: {
        accountId: 'account-a',
        billingPrincipalId: 'principal-a',
        deletionGeneration: '0',
        collection: { ...info.key, namespace: 'account_account-a' },
        device: { ...first, generation: 'registered-generation' },
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      identity: { accountId: 'account-a', email: 'synthetic@example.invalid' },
    }
    await devices.writeVerified(cached)
    await repo.close()
    repo = await openNativeRepository({ databaseName: name })
    devices = createNativeDeviceStore(repo)
    assert((await devices.read('account-a')).generation === 'registered-generation')
    assert((await devices.readVerified())?.identity.email === cached.identity.email)
    let changed = false
    try {
      await devices.write('account-a', { ...other, generation: 'wrong-owner' })
    } catch {
      changed = true
    }
    assert(changed)
    await devices.clearVerified()
    assert((await devices.readVerified()) === null)
    await repo.close()
  })
  await test('native Web Locks exclude a second foreground sync owner until release', async () => {
    const lease = createTabLease()
    const scope = {
      key: fixture(true).key,
      device: { id: 'lease-device', generation: 'lease-generation' },
      generation: 0,
    }
    const signal = new AbortController().signal
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>((resolve) => (enter = resolve))
    const held = new Promise<void>((resolve) => (release = resolve))
    const first = lease.run(scope, signal, async () => {
      enter()
      await held
    })
    await entered
    assert(
      (await lease.run(scope, signal, async () => {
        throw new Error('Double owner')
      })) === false,
    )
    release()
    assert(await first)
    assert(await lease.run(scope, signal, async () => {}))
  })
  await test('actual native app/network subscriptions and microphone permission inspection', async () => {
    const events: NativeLifecycleEvent[] = []
    const dispose = await subscribeNativeLifecycle((event) => events.push(event))
    assert(events.some((event) => event.type === 'active'))
    assert(events.some((event) => event.type === 'network'))
    await dispose()
    const permission = await CapacitorAudioRecorder.checkPermissions()
    assert(
      ['prompt', 'prompt-with-rationale', 'granted', 'denied'].includes(permission.recordAudio),
    )
    assert((await CapacitorAudioRecorder.getRecordingStatus()).status === 'INACTIVE')
  })
  await test('native WebView normalizes a synthetic photo to resized JPEG pixels', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 10
    canvas.height = 10
    canvas.getContext('2d')!.fillRect(0, 0, 10, 10)
    const input = await normalizeNativePhoto({
      format: 'png',
      base64String: canvas.toDataURL('image/png').split(',')[1],
    })
    assert(input.bytes.type === 'image/jpeg' && input.bytes.size > 0 && input.bytes.size < 4096)
  })
}

/** Explicit test-owned UI actions. Never automatically opens a microphone/camera/store transaction. */
export function installManualFlows() {
  const share = new NativeShare(),
    camera = new NativeCamera(() => true)
  const audio = new NativeAudio({
    isCurrent: () => true,
    onInterrupted: (result) => run('audio-interrupted', async () => result),
  })
  const flows: { action: string; status: string; bytes?: number; type?: string; code?: string }[] =
    []
  async function run(action: string, task: () => Promise<BoundaryResult<unknown>>) {
    const result = await task()
    const value = result.status === 'ok' ? result.value : undefined
    const bytes =
      value instanceof Blob
        ? value
        : value && typeof value === 'object' && 'bytes' in value && value.bytes instanceof Blob
          ? value.bytes
          : undefined
    flows.push({
      action,
      status: result.status,
      ...(bytes ? { bytes: bytes.size, type: bytes.type } : {}),
      ...('error' in result ? { code: result.error.code } : {}),
    })
    document.getElementById('flows')!.textContent = JSON.stringify(flows)
    await Filesystem.writeFile({
      path: 'loopmark-native-flow-results.json',
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: JSON.stringify(flows),
    })
  }
  document.getElementById('test-share')!.onclick = () => {
    void run('share', () =>
      share.shareFile({
        name: 'loopmark-synthetic.json',
        mimeType: 'application/json',
        bytes: new Blob(['{"fixture":"Loopmark native share"}'], { type: 'application/json' }),
      }),
    )
  }
  document.getElementById('test-picker')!.onclick = () => {
    void run('picker', () => share.chooseFile())
  }
  document.getElementById('test-photo')!.onclick = () => {
    void run('photo', () => camera.photo())
  }
  document.getElementById('test-audio-start')!.onclick = () => {
    void run('audio-start', () => audio.startRecording())
  }
  document.getElementById('test-audio-stop')!.onclick = () => {
    void run('audio-stop', () => audio.stopRecording())
  }
  document.getElementById('flows')!.textContent = 'Native UI fixtures ready'
}
