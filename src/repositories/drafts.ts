export interface DraftRecord<T> {
  key: string
  value: T
  revision: string
  baseRevision?: string
}

/** Each store is permanently bound to its opening collection and generation. */
export interface DraftStore {
  read<T>(key: string): Promise<DraftRecord<T> | undefined>
  write<T>(key: string, previous: string | undefined, draft?: DraftRecord<T>): Promise<void>
  removeProjectDrafts(projectId: string): Promise<void>
}
