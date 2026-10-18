import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { ProjectView } from '../../src/components/ProjectView'
import { DomainError } from '../../src/domain/errors'
import type { Project } from '../../src/types'
import backup from '../fixtures/expansion/portable-v1.json'
const project = backup.projects[0] as Project
const noop = () => {}
createRoot(document.getElementById('root')!).render(
  <main className="main-content">
    <ProjectView
      project={project}
      onBack={noop}
      onCheckpoint={noop}
      onEdit={noop}
      onLabel={noop}
      onStatus={noop}
      onDelete={noop}
      mediaAvailability={[
        { checkpointId: project.checkpoints[0].id, kind: 'photo', state: 'missing' },
      ]}
      onDownload={async () => {
        const failure = new URLSearchParams(location.search).get('failure')
        if (failure === 'auth') throw new DomainError('AUTH_REQUIRED')
        if (failure === 'storage') throw new DomainError('LOCAL_STORAGE_FAILED')
        throw new Error('private-provider-token-and-craft-text')
      }}
      downloads={
        <section aria-label="Project files">
          <h2>Project files</h2>
          <p>Available offline on this device</p>
        </section>
      }
    />
  </main>,
)
