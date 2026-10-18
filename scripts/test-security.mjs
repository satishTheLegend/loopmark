#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Local checks only. Actual role/tenant/provider authority is tested separately against the real backend.
const roots = ['dist', 'ios/App/App/public', 'android/app/src/main/assets/public']
let count = 0
const findings = []
async function scan(root, required) {
  try {
    await stat(root)
  } catch {
    if (required) findings.push({ path: root, reason: 'Build required before security checks' })
    return
  }
  for (const file of await readdir(root, { recursive: true })) {
    if (!/\.(?:js|json|html|xml|plist|txt)$/i.test(file)) continue
    const path = join(root, file),
      content = await readFile(path, 'utf8')
    count++
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sb_secret_|sk_live_|sk_test_)[A-Za-z0-9_-]{16,}/.test(
        content,
      )
    )
      findings.push({ path, reason: 'Private credential pattern' })
    for (const token of content.match(
      /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    ) ?? []) {
      try {
        if (
          JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role ===
          'service_role'
        )
          findings.push({ path, reason: 'Service-role JWT' })
      } catch {
        /* Not a JWT. */
      }
    }
    if (file.endsWith('.html') && /native persistence fixture|Test-only entry point/.test(content))
      findings.push({ path, reason: 'Test harness in product artifact' })
  }
}
for (const root of roots) await scan(root, root === 'dist')
console.log(
  JSON.stringify({
    scope: 'Built web and present native web assets; credential patterns and harness markers only',
    filesScanned: count,
    findings,
  }),
)
if (findings.length) process.exit(1)
for (const [command, args] of [
  [process.execPath, ['--test', 'tests/security/service-worker.test.mjs']],
  [
    'npx',
    [
      'vitest',
      'run',
      'src/config.test.ts',
      'src/domain/contracts.test.ts',
      'src/domain/policy.test.ts',
      'src/auth/auth-service.test.ts',
      'src/billing/coordinator.test.ts',
      'src/platform/browser/purchases.test.ts',
      'src/links/purchase-return.test.ts',
    ],
  ],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(
  'Local security checks passed. Live backend authority, provider sandbox, signing and physical-device checks remain separate evidence.',
)
