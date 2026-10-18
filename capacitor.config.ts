import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.loopmark.craft',
  appName: 'Loopmark',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'automatic' },
  plugins: { CapacitorHttp: { enabled: false } },
}

export default config
