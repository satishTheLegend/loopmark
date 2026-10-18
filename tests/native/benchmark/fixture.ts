import type { Backup } from '../../../src/domain/contracts'
import { MAX_LIBRARY_BYTES, utf8Bytes } from '../../../src/domain/policy'
import { bytesToDataUrl } from '../../../src/services/media-codec'

/** Valid, unique PCM containers. No external media or image library is involved. */
function wave(size: number, seed: number) {
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, size - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, 48000, true)
  view.setUint32(28, 192000, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, size - 44, true)
  let random = seed + 1
  for (let i = 44; i < size; i++) {
    random ^= random << 13
    random ^= random >>> 17
    random ^= random << 5
    bytes[i] = random & 255
  }
  return bytesToDataUrl(bytes, 'audio/wav')
}
export function benchmarkFixture(kind: 'small' | 'limit'): Backup {
  const projectCount = kind === 'small' ? 10 : 200,
    checkpointsPerProject = kind === 'small' ? 10 : 5,
    voiceCount = kind === 'small' ? 100 : 6,
    time = '2026-01-01T00:00:00.000Z'
  const backup: Backup = {
    format: 'loopmark',
    version: 1,
    exportedAt: time,
    projects: Array.from({ length: projectCount }, (_, p) => ({
      id: `benchmark_project_${p}`,
      code: `BENCH-${p + 1}`,
      name: `Synthetic craft ${p + 1}`,
      craft: 'Crochet',
      color: 'clay',
      toolSize: '4 mm',
      yarn: 'Synthetic fixture',
      notes: '',
      status: 'finished',
      createdAt: time,
      updatedAt: time,
      checkpoints: Array.from({ length: checkpointsPerProject }, (_, c) => ({
        id: `benchmark_checkpoint_${p}_${c}`,
        createdAt: time,
        position: `Row ${c + 1}`,
        toolSize: '4 mm',
        nextStep: 'Turn and begin the next repeat.',
        notes: '',
      })),
    })),
  }
  const checkpoints = backup.projects.flatMap((p) => p.checkpoints)
  // Estimate exact per-string overhead without allocating the large fixture twice.
  for (let i = 0; i < voiceCount; i++) checkpoints[i].voice = 'data:audio/wav;base64,'
  const overhead = utf8Bytes(backup)
  const rawBytes =
    kind === 'small'
      ? 60 * 1024
      : Math.floor((((MAX_LIBRARY_BYTES - overhead) / voiceCount) * 3) / 4 / 12) * 12
  for (let i = 0; i < voiceCount; i++) checkpoints[i].voice = wave(rawBytes, i)
  if (kind === 'limit') {
    const remaining = MAX_LIBRARY_BYTES - utf8Bytes(backup)
    if (remaining < 0 || remaining > 100) throw new Error('Invalid boundary fixture arithmetic.')
    backup.projects[0].notes = 'x'.repeat(remaining)
    if (utf8Bytes(backup) !== MAX_LIBRARY_BYTES)
      throw new Error('Boundary fixture must be exactly 48 MiB serialized.')
  }
  return backup
}
