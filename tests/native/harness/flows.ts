import { CapacitorAudioRecorder } from '@capgo/capacitor-audio-recorder'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { createNativeDeviceStore } from '../../../src/platform/native/device-store'
import {
  subscribeNativeLifecycle,
  type NativeLifecycleEvent,
} from '../../../src/platform/native/lifecycle'
import { NativeCamera, normalizeNativePhoto } from '../../../src/platform/native/camera'
import { NativeShare } from '../../../src/platform/native/share'
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
}
