import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { SharePort } from '../contracts'
import type { BoundaryResult } from '../../domain/contracts'
import { DomainError } from '../../domain/errors'
import { MAX_BACKUP_BYTES } from '../../domain/policy'
import { cancelled, nativeFailure, requireNative } from './boundary'

const ROOT = 'loopmark-exports'
const encode = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
/** Completed share files remain in private cache for 24h so a receiving app can finish reading. */
async function clearExpiredExports() {
  const directory = await Filesystem.readdir({ path: ROOT, directory: Directory.Cache }).catch(
    () => null,
  )
  for (const item of directory?.files ?? [])
    if (/^[0-9a-f-]{36}$/.test(item.name) && item.mtime < Date.now() - 86_400_000)
      await Filesystem.rmdir({
        path: `${ROOT}/${item.name}`,
        directory: Directory.Cache,
        recursive: true,
      }).catch(() => undefined)
}
/** Internal shared path for OS sharing and measured native export-file preparation. */
export async function stageNativeExport(input: { name: string; bytes: Blob }) {
  requireNative()
  if (
    !input.bytes.size ||
    input.bytes.size > MAX_BACKUP_BYTES ||
    !input.name ||
    input.name.length > 120 ||
    !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(input.name)
  )
    throw new DomainError('VALIDATION')
  await clearExpiredExports()
  const directory = `${ROOT}/${crypto.randomUUID()}`
  await Filesystem.mkdir({ path: directory, directory: Directory.Cache, recursive: true })
  try {
    const path = `${directory}/${input.name}`
    // Bounded bridge calls avoid one additional 68MiB base64 string for a maximum backup.
    for (let offset = 0; offset < input.bytes.size; offset += 512 * 1024) {
      const data = encode(
        new Uint8Array(await input.bytes.slice(offset, offset + 512 * 1024).arrayBuffer()),
      )
      if (offset === 0) await Filesystem.writeFile({ path, directory: Directory.Cache, data })
      else await Filesystem.appendFile({ path, directory: Directory.Cache, data })
    }
    if ((await Filesystem.stat({ path, directory: Directory.Cache })).size !== input.bytes.size)
      throw new DomainError('BACKUP_INCOMPLETE')
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
    return { directory, uri }
  } catch (error) {
    await Filesystem.rmdir({ path: directory, directory: Directory.Cache, recursive: true }).catch(
      () => undefined,
    )
    throw error
  }
}
export class NativeShare implements SharePort {
  private sharing = false
  private picking = false
  async shareFile(input: {
    name: string
    mimeType: string
    bytes: Blob
  }): Promise<BoundaryResult<void>> {
    if (this.sharing) return nativeFailure(new DomainError('CAPABILITY_UNAVAILABLE'))
    this.sharing = true
    let directory: string | undefined,
      completed = false
    try {
      requireNative()
      if (!(await Share.canShare()).value) throw new DomainError('CAPABILITY_UNAVAILABLE')
      const staged = await stageNativeExport(input)
      directory = staged.directory
      await Share.share({
        title: input.name,
        dialogTitle: 'Save or share this file',
        files: [staged.uri],
      })
      completed = true
      return { status: 'ok', value: undefined }
    } catch (error) {
      return nativeFailure(error)
    } finally {
      if (directory && !completed)
        await Filesystem.rmdir({
          path: directory,
          directory: Directory.Cache,
          recursive: true,
        }).catch(() => undefined)
      this.sharing = false
    }
  }
  async chooseFile(): Promise<BoundaryResult<Blob>> {
    if (this.picking) return nativeFailure(new DomainError('CAPABILITY_UNAVAILABLE'))
    try {
      requireNative()
    } catch (error) {
      return nativeFailure(error)
    }
    this.picking = true
    // Keep click in the initiating user-gesture call stack; the WebView invokes its OS picker.
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.style.display = 'none'
      document.body.append(input)
      let settled = false,
        timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: BoundaryResult<Blob>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        window.removeEventListener('focus', onFocus)
        input.remove()
        this.picking = false
        resolve(result)
      }
      const selected = () => {
        const file = input.files?.[0]
        if (!file) finish(cancelled())
        else if (!file.size || file.size > MAX_BACKUP_BYTES)
          finish(nativeFailure(new DomainError('VALIDATION')))
        else finish({ status: 'ok', value: file })
      }
      const onFocus = () => {
        timer = setTimeout(() => {
          if (!settled) selected()
        }, 500)
      }
      input.addEventListener('change', selected, { once: true })
      input.addEventListener('cancel', () => finish(cancelled()), { once: true })
      window.addEventListener('focus', onFocus)
      try {
        input.click()
      } catch (error) {
        finish(nativeFailure(error))
      }
    })
  }
}
