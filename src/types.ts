export type Craft = 'Crochet' | 'Knitting' | 'Other'
export type ProjectColor = 'clay' | 'sage' | 'lavender' | 'ochre'
export interface Checkpoint {
  id: string
  createdAt: string
  position: string
  toolSize: string
  nextStep: string
  notes: string
  photo?: string
  voice?: string
}
export interface Project {
  id: string
  code: string
  name: string
  craft: Craft
  color: ProjectColor
  yarn: string
  toolSize: string
  notes: string
  status: 'active' | 'finished'
  createdAt: string
  updatedAt: string
  checkpoints: Checkpoint[]
  sample?: boolean
}
export interface Backup {
  format: 'loopmark'
  version: 1
  exportedAt: string
  projects: Project[]
}
export type ProjectInput = Pick<Project, 'name' | 'craft' | 'color' | 'yarn' | 'toolSize' | 'notes'>
export type CheckpointInput = Omit<Checkpoint, 'id' | 'createdAt'>
