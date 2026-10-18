import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import { root } from './process.mjs'

// Render the existing Loopmark brand mark; no image service, network, or new icon library.
const svg = await readFile(`${root}/public/icon.svg`, 'utf8')
const mark = svg.replace(/<rect\b[^>]*\/>/, '')
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await files(path)))
    else if (entry.name.endsWith('.png')) result.push(path)
  }
  return result
}
const targets = [
  ...(await files(`${root}/ios/App/App/Assets.xcassets`)),
  ...(await files(`${root}/android/app/src/main/res`)),
]
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/*', (route) => route.abort())
  for (const path of targets) {
    const { width, height } = PNG.sync.read(await readFile(path))
    const foreground = basename(path) === 'ic_launcher_foreground.png'
    const round = basename(path) === 'ic_launcher_round.png'
    const splash = /splash/i.test(path)
    const encoded = await page.evaluate(
      async ({ svg, mark, width, height, foreground, round, splash, ios }) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas unavailable')
        if (round) {
          ctx.beginPath()
          ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2)
          ctx.clip()
        }
        if (!foreground) {
          ctx.fillStyle = splash ? '#fff9ed' : '#A64B31'
          ctx.fillRect(0, 0, width, height)
        }
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(foreground ? mark : svg)}`
        await image.decode()
        const size = splash
          ? Math.round(Math.min(width, height) * (ios ? 0.18 : 0.24))
          : Math.min(width, height)
        ctx.drawImage(image, (width - size) / 2, (height - size) / 2, size, size)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { svg, mark, width, height, foreground, round, splash, ios: path.includes('/ios/') },
    )
    const bytes = Buffer.from(encoded, 'base64')
    const png = PNG.sync.read(bytes)
    if (!foreground && !round && png.data.some((value, index) => index % 4 === 3 && value !== 255))
      throw new Error(`Unexpected transparent brand asset: ${path}`)
    await writeFile(path, bytes)
  }
  process.stdout.write(`Rendered ${targets.length} native assets from public/icon.svg.\n`)
} finally {
  await browser.close()
}
