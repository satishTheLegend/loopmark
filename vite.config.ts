import { defineConfig } from 'vitest/config'
import { loadEnv, type ViteDevServer, type PreviewServer } from 'vite'
import { readFile } from 'node:fs/promises'
import react from '@vitejs/plugin-react'
import { loadOperatorConfig } from './scripts/lib/config.mjs'
import { parsePublicConfig } from './src/config.ts'
import { publicPath, renderPublicPage, supportContact } from './src/pages/public-pages.ts'
export default defineConfig(async ({ mode }) => {
  const { config } = await loadOperatorConfig()
  const environment = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  // Fail before bundling an unknown VITE_ setting; runtime fallback cannot unpublish a secret.
  const publicConfig = parsePublicConfig(environment)
  const supportEmail = supportContact(environment.LOOPMARK_PUBLIC_SUPPORT_EMAIL)
  return {
    plugins: [
      react(),
      {
        name: 'loopmark-public-pages',
        configurePreviewServer(server: PreviewServer) {
          server.middlewares.use(async (request, response, next) => {
            const page = publicPath(new URL(request.url || '/', 'http://localhost').pathname)
            if (!page) return next()
            try {
              const html = await readFile(`dist${page}/index.html`)
              response.setHeader('Content-Type', 'text/html; charset=utf-8')
              response.setHeader('Referrer-Policy', 'no-referrer')
              response.end(html)
            } catch (error) {
              next(error)
            }
          })
        },
        configureServer(server: ViteDevServer) {
          server.middlewares.use(async (request, response, next) => {
            const pathname = new URL(request.url || '/', 'http://localhost').pathname
            const page = publicPath(pathname)
            if (page) {
              response.setHeader('Content-Type', 'text/html; charset=utf-8')
              response.setHeader('Referrer-Policy', 'no-referrer')
              response.end(renderPublicPage(page, { config: publicConfig, supportEmail }))
              return
            }
            const font = {
              '/fonts/dm-sans-latin-400-normal.woff2': 'dm-sans',
              '/fonts/lora-latin-500-normal.woff2': 'lora',
            }[pathname]
            if (!font) return next()
            try {
              const bytes = await readFile(
                `node_modules/@fontsource/${font}/files/${pathname.split('/').pop()}`,
              )
              response.setHeader('Content-Type', 'font/woff2')
              response.end(bytes)
            } catch (error) {
              next(error)
            }
          })
        },
      },
    ],
    server: { host: config.host, port: config.ports.app, strictPort: true },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
