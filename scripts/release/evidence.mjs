import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'

export function requiredGates(environment, platform) {
  if (
    !['staging', 'production'].includes(environment) ||
    !['web', 'ios', 'android'].includes(platform)
  )
    throw new Error('Invalid release target')
  return [
    'regression',
    'security',
    'compatibility',
    'accessibility',
    'recovery-drill',
    'operations',
    'configuration',
    'support-privacy',
    'funding',
    'release-owner-review',
    ...(platform === 'web'
      ? ['provider-sandbox-web', 'host-routing']
      : [
          'native-build',
          'native-persistence',
          'physical-device',
          'store-sandbox',
          'signing',
          'install-upgrade',
          'deep-links',
          'store-disclosures',
        ]),
    ...(environment === 'production' ? ['pilot-decision'] : []),
  ]
}
const exactKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key))
export async function evaluateRelease({ root, manifest, environment, platform, revision, clean }) {
  const required = requiredGates(environment, platform)
  const report = {
    schemaVersion: 1,
    environment,
    platform,
    status: 'blocked',
    performedRelease: false,
    checks: [],
  }
  const check = (id, pass, message) =>
    report.checks.push({ id, status: pass ? 'pass' : 'blocked', message })
  if (
    !exactKeys(manifest, [
      'schemaVersion',
      'environment',
      'platform',
      'revision',
      'artifacts',
      'gates',
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.environment !== environment ||
    manifest.platform !== platform ||
    !/^[a-f0-9]{40}$/.test(manifest.revision ?? '') ||
    !Array.isArray(manifest.artifacts) ||
    !manifest.artifacts.length ||
    manifest.artifacts.length > 10 ||
    !Array.isArray(manifest.gates) ||
    manifest.gates.length > 50
  ) {
    check(
      'manifest',
      false,
      'Supply a version-1 release evidence manifest for this exact target and revision.',
    )
    return report
  }
  check(
    'source-revision',
    manifest.revision === revision && clean,
    'Evidence must identify the clean current source revision.',
  )
  const realRoot = await realpath(root)
  async function verifyFile(item, evidence) {
    if (
      !exactKeys(item, ['path', 'sha256']) ||
      typeof item.path !== 'string' ||
      item.path.length > 250 ||
      isAbsolute(item.path) ||
      !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')
    )
      return false
    if (
      evidence &&
      !['docs/evidence/', '.gstack/release/'].some((prefix) => item.path.startsWith(prefix))
    )
      return false
    try {
      const file = await realpath(resolve(realRoot, item.path)),
        rel = relative(realRoot, file)
      if (rel.startsWith('..') || isAbsolute(rel)) return false
      const info = await stat(file)
      if (!info.isFile() || !info.size || (evidence && info.size > 10 * 1024 * 1024)) return false
      const hash = createHash('sha256')
      for await (const bytes of createReadStream(file)) hash.update(bytes)
      return hash.digest('hex') === item.sha256
    } catch {
      return false
    }
  }
  for (let i = 0; i < manifest.artifacts.length; i++)
    check(
      `artifact-${i + 1}`,
      await verifyFile(manifest.artifacts[i], false),
      'Artifact bytes must match the recorded SHA-256 inside this checkout.',
    )
  const ids = manifest.gates.map((gate) => gate?.id)
  check(
    'gate-identities',
    new Set(ids).size === ids.length && ids.every((id) => required.includes(id)),
    'Gate IDs must be unique and belong to this platform and environment.',
  )
  for (const id of required) {
    const gate = manifest.gates.find((item) => item?.id === id)
    const shape =
      exactKeys(gate, ['id', 'status', 'evidence']) &&
      ['pass', 'fail', 'blocked', 'unverified'].includes(gate.status) &&
      Array.isArray(gate.evidence) &&
      gate.evidence.length > 0 &&
      gate.evidence.length <= 10
    const verified =
      shape &&
      gate.status === 'pass' &&
      (await Promise.all(gate.evidence.map((item) => verifyFile(item, true)))).every(Boolean)
    check(
      id,
      !!verified,
      verified
        ? 'Recorded PASS has matching evidence files; inspect the actual scope and reviewer conclusions.'
        : 'A required actual evaluation is missing, not passing, or has changed evidence bytes.',
    )
  }
  if (report.checks.every((item) => item.status === 'pass')) report.status = 'evidence-complete'
  return report
}
