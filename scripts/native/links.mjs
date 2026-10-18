import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root } from './process.mjs'

export function renderLinks(config, applicationId) {
  const { appOrigin, appleApplicationIdentifier, androidSha256 } = config
  let url
  try {
    url = new URL(appOrigin)
  } catch {
    throw new Error('appOrigin must be an exact HTTPS origin.')
  }
  if (
    typeof appOrigin !== 'string' ||
    url.protocol !== 'https:' ||
    url.origin !== appOrigin ||
    url.port ||
    url.username ||
    url.password ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)
  )
    throw new Error('Use one exact HTTPS DNS origin without a port, path, query or wildcard.')
  if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){2,}$/.test(applicationId))
    throw new Error('Invalid application ID.')
  if (
    typeof appleApplicationIdentifier !== 'string' ||
    !/^[A-Z0-9]{10}\./.test(appleApplicationIdentifier) ||
    appleApplicationIdentifier.slice(11) !== applicationId
  )
    throw new Error(
      'Apple application identifier must be the actual app-ID prefix followed by this bundle identifier.',
    )
  if (
    !Array.isArray(androidSha256) ||
    !androidSha256.length ||
    androidSha256.length > 4 ||
    androidSha256.some(
      (value) => typeof value !== 'string' || !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value),
    ) ||
    new Set(androidSha256).size !== androidSha256.length
  )
    throw new Error(
      'Provide one to four distinct SHA-256 release signing certificate fingerprints in uppercase colon notation.',
    )
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  return {
    aasa: json({
      applinks: {
        details: [
          {
            appIDs: [appleApplicationIdentifier],
            components: [
              {
                '/': '/p/*',
                comment: 'Project links still require local or authenticated access.',
              },
              { '/': '/auth/callback', comment: 'One-use verified authentication callback.' },
            ],
          },
        ],
      },
    }),
    assetlinks: json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: applicationId,
          sha256_cert_fingerprints: androidSha256,
        },
      },
    ]),
    entitlements: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>com.apple.developer.associated-domains</key><array><string>applinks:${url.hostname}</string></array></dict></plist>\n`,
    intent: `            <!-- BEGIN LOOPMARK VERIFIED LINKS -->\n            <intent-filter android:autoVerify="true">\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="https" android:host="${url.hostname}" />\n                <data android:pathPrefix="/p/" />\n                <data android:path="/auth/callback" />\n            </intent-filter>\n            <!-- END LOOPMARK VERIFIED LINKS -->`,
  }
}

async function main() {
  const [configPath, outputPath, mode] = process.argv.slice(2)
  if (!configPath || !outputPath || (mode && mode !== '--apply'))
    throw new Error(
      'Usage: node scripts/native/links.mjs CONFIG.json NEW_OUTPUT_DIRECTORY [--apply]',
    )
  const config = JSON.parse(await readFile(resolve(configPath), 'utf8'))
  const capacitor = await readFile(`${root}/capacitor.config.ts`, 'utf8')
  const applicationId = /appId:\s*['"]([^'"]+)['"]/.exec(capacitor)?.[1]
  const files = renderLinks(config, applicationId)
  const out = resolve(outputPath)
  // Refuse to merge with or overwrite an existing output directory.
  await mkdir(out)
  await mkdir(`${out}/.well-known`)
  await writeFile(`${out}/.well-known/apple-app-site-association`, files.aasa, { flag: 'wx' })
  await writeFile(`${out}/.well-known/assetlinks.json`, files.assetlinks, { flag: 'wx' })
  await writeFile(`${out}/App.entitlements`, files.entitlements, { flag: 'wx' })
  await writeFile(`${out}/android-intent-filter.xml`, files.intent, { flag: 'wx' })
  if (mode === '--apply') {
    const path = `${root}/android/app/src/main/AndroidManifest.xml`
    const manifest = await readFile(path, 'utf8')
    const marker =
      /            <!-- BEGIN LOOPMARK VERIFIED LINKS -->[\s\S]*?            <!-- END LOOPMARK VERIFIED LINKS -->/
    if (!marker.test(manifest))
      throw new Error('Native manifest link markers are missing; no project configuration changed.')
    await writeFile(path, manifest.replace(marker, files.intent))
    await writeFile(`${root}/ios/App/App/App.entitlements`, files.entitlements)
  }
  process.stdout.write(
    'Prepared local association files. No hosting, signing, domain verification or publication was performed.\n',
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()
