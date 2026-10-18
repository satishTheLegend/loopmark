import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.loopmark.craft',
  appName: 'Loopmark',
  webDir: 'dist',
  // Plugin arguments can contain notes, media and credentials even in a debug build.
  loggingBehavior: 'none',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'automatic' },
  plugins: {
    CapacitorHttp: { enabled: false },
    CapacitorSQLite: { iosDatabaseLocation: 'Library/Loopmark/Databases' },
  },
}

export default config
