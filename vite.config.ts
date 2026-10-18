import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadOperatorConfig } from './scripts/lib/config.mjs'
export default defineConfig(async () => {
  const { config } = await loadOperatorConfig()
  return {
    plugins: [react()],
    server: { host: config.host, port: config.ports.app, strictPort: true },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
