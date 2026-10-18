import { useCallback, useEffect, useState } from 'react'
import type { AppRuntime } from '../runtime'
import type { SavedDeletionReceipt } from '../services/deletion-service'
import { DeletionReceiptView } from './DeletionReceiptView'
import { ErrorMessage, errorText } from './ui'

export function AccountReceipts({ runtime }: { runtime: AppRuntime }) {
  const [receipts, setReceipts] = useState<SavedDeletionReceipt[]>([])
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      setReceipts(await runtime.deletion.listReceipts())
      setError('')
    } catch (failure) {
      setError(errorText(failure))
    }
  }, [runtime])
  useEffect(() => {
    void reload()
    return runtime.subscribeDeletion(() => void reload())
  }, [runtime, reload])
  async function download(id: string) {
    const bytes = await runtime.deletion.exportReceipt(id)
    const name = 'loopmark-private-deletion-receipt.json'
    if (runtime.share) {
      const result = await runtime.share.shareFile({ name, mimeType: 'application/json', bytes })
      if ('error' in result) throw new Error(`${result.error.problem} ${result.error.nextAction}`)
      return
    }
    const url = URL.createObjectURL(bytes)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <>
      <ErrorMessage message={error} />
      {receipts.map((saved) => (
        <DeletionReceiptView
          key={saved.id}
          receipt={saved.receipt}
          requestedAt={saved.createdAt}
          localOutcome={saved.localOutcome}
          onRefresh={async () => {
            await runtime.deletion.refreshReceipt(saved.id, AbortSignal.timeout(30_000))
            await reload()
          }}
          onDownload={() => download(saved.id)}
        />
      ))}
    </>
  )
}
