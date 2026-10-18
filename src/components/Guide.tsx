import {
  IconBookmarkPlus,
  IconNeedleThread,
  IconArrowBackUp,
  IconDownload,
} from '@tabler/icons-react'
export function Guide({ onNew, onBackup }: { onNew: () => void; onBackup: () => void }) {
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">A KINDER WAY TO COME BACK</div>
          <h1>Leave a note. Find your rhythm.</h1>
          <p>Loopmark is a little memory for the things you make.</p>
        </div>
      </header>
      <div className="guide-banner">
        <img
          src="/art/workbasket.svg"
          alt="A basket of yarn, needles, and a handwritten project tag"
        />
        <div>
          <h2>
            Your project can wait.
            <br />
            Your place won’t get lost.
          </h2>
          <p>You don’t need a perfect record. Just enough to know what to do when you return.</p>
          <button className="button primary" onClick={onNew}>
            Add a project
          </button>
        </div>
      </div>
      <div className="guide-steps">
        {[
          {
            icon: IconNeedleThread,
            title: 'Give it a little home',
            text: 'Add a project name, craft, and hook or needle size. A yarn shade or pattern note can help too.',
          },
          {
            icon: IconBookmarkPlus,
            title: 'Pause with a checkpoint',
            text: 'Before you put it away, write what you will do next. Add your row, a photo, or a quick voice note if it helps.',
          },
          {
            icon: IconArrowBackUp,
            title: 'Come back with confidence',
            text: 'Open your project to see your latest next step. Earlier checkpoints are there whenever you need the story.',
          },
        ].map(({ icon: Icon, title, text }, i) => (
          <section key={title}>
            <span className="guide-number">{i + 1}</span>
            <Icon size={24} />
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
      </div>
      <section className="tip-note">
        <IconDownload size={24} />
        <div>
          <h3>One thing to remember</h3>
          <p>
            Your projects live in this browser, on this device. Download a full backup before
            clearing browser data or moving to another device. Bag-label QR codes are shortcuts, not
            backups.
          </p>
          <button className="text-button" onClick={onBackup}>
            Go to backup & restore →
          </button>
        </div>
      </section>
    </>
  )
}
