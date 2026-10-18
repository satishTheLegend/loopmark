// Test-only browser entry, bundled in-memory by Playwright. Never part of the application entry.
export { openBrowserRepository } from '../../src/repositories/browser/repository'
export {
  migrateLegacy,
  readMigrationSelection,
  readMigratedDraft,
  readLegacySnapshot,
  portableProjects,
} from '../../src/repositories/browser/migration'
export { info, project, now, png, wav } from '../../src/repositories/browser/fixtures.test-support'
