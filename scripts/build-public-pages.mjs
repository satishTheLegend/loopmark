import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { loadEnv } from 'vite'
import { parsePublicConfig } from '../src/config.ts'
import { publicPaths, renderPublicPage, supportContact } from '../src/pages/public-pages.ts'

const environment = { ...loadEnv('production', process.cwd(), ''), ...process.env }
const config = parsePublicConfig(environment)
const supportEmail = supportContact(environment.LOOPMARK_PUBLIC_SUPPORT_EMAIL)
for (const path of publicPaths) {
  await mkdir(`dist${path}`, { recursive: true })
  await writeFile(`dist${path}/index.html`, renderPublicPage(path, { config, supportEmail }))
}
await mkdir('dist/fonts', { recursive: true })
for (const [packageName, file] of [
  ['dm-sans', 'dm-sans-latin-400-normal.woff2'],
  ['lora', 'lora-latin-500-normal.woff2'],
])
  await copyFile(`node_modules/@fontsource/${packageName}/files/${file}`, `dist/fonts/${file}`)

// The app remains noindex. Only these content-only pages can enter a public sitemap.
const indexable = config.appOrigin && new URL(config.appOrigin).protocol === 'https:'
await writeFile(
  'dist/robots.txt',
  indexable
    ? `User-agent: *\nDisallow: /\n${publicPaths.map((path) => `Allow: ${path}$\nAllow: ${path}/`).join('\n')}\nAllow: /public-pages.css\nAllow: /fonts/\nAllow: /icon.svg\nSitemap: ${config.appOrigin}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n',
)
if (indexable)
  await writeFile(
    'dist/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPaths.map((path) => `<url><loc>${config.appOrigin}${path}</loc></url>`).join('')}</urlset>`,
  )
console.log(
  `Public help pages: ${publicPaths.length}; indexing ${indexable ? 'limited to public pages' : 'disabled without public HTTPS origin'}`,
)
