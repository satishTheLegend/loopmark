import { readFile, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const developerDocs = [
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  ...[
    'README',
    'quickstart',
    'configuration',
    'testing',
    'native',
    'provider-sandbox',
    'migrations',
  ].map((name) => `docs/developer/${name}.md`),
  'docs/evidence/expansion/dx/README.md',
]
/** Read-only validation; no URLs are fetched and no documented command is executed. */
export async function validateDocs(root = process.cwd()) {
  const failures = [],
    packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const template = await readFile(resolve(root, '.env.example'), 'utf8')
  const supportedNames = new Set(
    [...template.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]),
  )
  for (const name of [
    'LOOPMARK_JAVA_HOME',
    'LOOPMARK_NATIVE_TEST_BUILD',
    'LOOPMARK_IOS_SIMULATOR',
    'LOOPMARK_SYNC_PUBLIC_ENV',
    'ANDROID_SERIAL',
    'ANDROID_HOME',
    'ANDROID_SDK_ROOT',
    'JAVA_HOME',
  ])
    supportedNames.add(name)
  for (const file of developerDocs) {
    let content
    try {
      content = await readFile(resolve(root, file), 'utf8')
    } catch {
      failures.push(`${file}: missing document`)
      continue
    }
    for (const [, command] of content.matchAll(/npm run ([a-z][a-z0-9:-]*)/g))
      if (!Object.hasOwn(packageJson.scripts, command))
        failures.push(`${file}: undocumented script target ${command}`)
    for (const [name] of content.matchAll(/\b(?:VITE_)?LOOPMARK_[A-Z0-9_]+\b/g))
      if (!supportedNames.has(name)) failures.push(`${file}: unknown configuration ${name}`)
    for (const [, link] of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|mailto:|#)/.test(link)) continue
      const target = decodeURIComponent(link.replace(/#.*$/, ''))
      const path = resolve(dirname(resolve(root, file)), target)
      if (!path.startsWith(resolve(root) + '/')) {
        failures.push(`${file}: link escapes repository`)
        continue
      }
      try {
        await access(path)
      } catch {
        failures.push(`${file}: missing link ${target}`)
      }
    }
  }
  for (const script of ['test:examples', 'test:docs', 'test:dx'])
    if (!packageJson.scripts[script])
      failures.push(`package.json: required ${script} script missing`)
  return failures
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = await validateDocs()
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  } else
    console.log(
      `PASS: ${developerDocs.length} developer documents; script, configuration and local-link references.`,
    )
}
