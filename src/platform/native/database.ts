import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { DomainError } from '../../domain/errors'
import { durableFiles } from './files-bridge'

/** All SQL users share one queue/connection, including reference cleanup and generation switches. */
export class NativeDatabase {
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private constructor(
    readonly connection: SQLiteDBConnection,
    private manager: SQLiteConnection,
    private name: string,
  ) {}
  static async open(name = 'loopmark') {
    if (!Capacitor.isNativePlatform()) throw new DomainError('NOT_AVAILABLE')
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new DomainError('VALIDATION')
    // Creates the parent Library/Loopmark backup exclusion before SQLite writes on iOS.
    await durableFiles.list()
    const manager = new SQLiteConnection(CapacitorSQLite)
    const connection = await manager.createConnection(name, false, 'no-encryption', 1, false)
    try {
      await connection.open()
      await connection.query('PRAGMA journal_mode=WAL')
      await connection.execute('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;', false)
      await connection.execute(`
      CREATE TABLE IF NOT EXISTS collections (key TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media (scope TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, file_key TEXT NOT NULL UNIQUE, prepared_at INTEGER NOT NULL, PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS pins (owner TEXT NOT NULL, scope TEXT NOT NULL, media_id TEXT NOT NULL, PRIMARY KEY(owner,scope,media_id));
      CREATE TABLE IF NOT EXISTS prepared_files (file_key TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL, media_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    `)
      // Additive local migration: old/source rows remain conservative local media.
      if (
        !(await connection.query('PRAGMA table_info(media)')).values?.some(
          (row) => row.name === 'downloaded',
        )
      )
        await connection.execute(
          'ALTER TABLE media ADD COLUMN downloaded INTEGER NOT NULL DEFAULT 0 CHECK(downloaded IN (0,1));',
        )
      return new NativeDatabase(connection, manager, name)
    } catch (error) {
      await manager.closeConnection(name, false).catch(() => undefined)
      if (error instanceof DomainError) throw error
      throw new DomainError('LOCAL_STORAGE_FAILED')
    }
  }
  serial<T>(operation: (connection: SQLiteDBConnection) => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (this.closed) throw new DomainError('LOCAL_STORAGE_FAILED')
      return operation(this.connection).catch((error) => {
        if (error instanceof DomainError) throw error
        throw new DomainError(
          error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'LOCAL_STORAGE_FULL'
            ? 'LOCAL_STORAGE_FULL'
            : 'LOCAL_STORAGE_FAILED',
        )
      })
    })
    this.tail = result.catch(() => undefined)
    return result
  }
  transaction<T>(operation: (connection: SQLiteDBConnection) => Promise<T>): Promise<T> {
    return this.serial(async (connection) => {
      await connection.beginTransaction()
      try {
        const result = await operation(connection)
        await connection.commitTransaction()
        return result
      } catch (error) {
        await connection.rollbackTransaction().catch(() => undefined)
        throw error
      }
    })
  }
  async close() {
    await this.serial(async () => {
      await this.manager.closeConnection(this.name, false)
      this.closed = true
    })
  }
}
