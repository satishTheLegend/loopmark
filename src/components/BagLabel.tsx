import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { IconPrinter, IconTag } from '@tabler/icons-react'
import type { Project } from '../types'
import { Dialog, Brand, ErrorMessage } from './ui'
export function BagLabel({ project: p, onClose }: { project: Project; onClose: () => void }) {
  const [qr, setQr] = useState(''),
    [error, setError] = useState(''),
    cp = p.checkpoints[0]
  const url = `${location.origin}/#project=${encodeURIComponent(p.id)}`
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, { width: 240, margin: 2, color: { dark: '#332D27', light: '#FFFFFF' } })
      .then((v) => {
        if (!cancelled) setQr(v)
      })
      .catch(() =>
        setError('The QR code could not be created. You can still use the readable project code.'),
      )
    return () => {
      cancelled = true
    }
  }, [url])
  return (
    <Dialog title="A tag for your project bag" onClose={onClose}>
      <p className="dialog-intro">
        Print, trim, and tuck it in. Your next step travels with your making.
      </p>
      <div className="bag-label printable">
        <Brand />
        <div className="label-divider" />
        <h3>{p.name}</h3>
        <span className="label-code">{p.code}</span>
        <div className="label-facts">
          <span>{p.craft}</span>
          <strong>{cp?.toolSize || p.toolSize || 'Tool not recorded'}</strong>
          <span>{cp?.position || 'Position not recorded'}</span>
        </div>
        <p>
          <strong>Next little step</strong>
          <br />
          {cp?.nextStep || 'Save a checkpoint when you pause.'}
        </p>
        <div className="label-bottom">
          {qr && (
            <img src={qr} width="100" height="100" alt="QR code to this project on this site" />
          )}
          <span>
            Scan to find your place.
            <br />
            <small>
              Opens on this site in the browser where your project is saved. This code is not a
              backup.
            </small>
          </span>
        </div>
      </div>
      <ErrorMessage message={error} />
      <p className="label-warning">
        <IconTag size={18} />
        Using another device? Restore your backup there first, on the same site. A localhost link
        works only on its original computer.
      </p>
      <div className="dialog-actions">
        <button className="button subtle" onClick={onClose}>
          Close
        </button>
        <button className="button primary" onClick={() => window.print()}>
          <IconPrinter size={18} />
          Print bag label
        </button>
      </div>
    </Dialog>
  )
}
