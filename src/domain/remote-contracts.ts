import type { CollectionKey } from './contracts'
export interface AttachPreview {
  id: string
  source: { key: CollectionKey; name: string; revision: string }
  destination: { key: CollectionKey; name: string; revision: string; email: string }
  additions: number
  matches: number
  copies: number
  mappings: Array<{
    sourceId: string
    sourceCode: string
    destinationId: string
    destinationCode: string
  }>
  resulting: {
    projects: number
    activeProjects: number
    checkpoints: number
    portableBytes: number
  }
  expiresAt: string
}
