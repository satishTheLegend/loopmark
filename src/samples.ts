import type { Backup, Project } from './types'
export function sampleBackup(): Backup {
  const date = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
  const projects: Project[] = [
    {
      id: crypto.randomUUID(),
      code: 'LM-DEMO1',
      name: 'The Sunday cardigan',
      craft: 'Crochet',
      color: 'clay',
      yarn: 'Cotton blend · Warm cinnamon',
      toolSize: '5 mm hook',
      notes: 'Sample project — a relaxed cardigan, made one quiet Sunday at a time.',
      status: 'active',
      createdAt: date(24),
      updatedAt: date(2),
      sample: true,
      checkpoints: [
        {
          id: crypto.randomUUID(),
          createdAt: date(2),
          position: 'Row 24 complete',
          toolSize: '5 mm hook',
          nextStep:
            'Start the left sleeve. Chain 2, turn, then work one half-double crochet into each stitch.',
          notes: 'Switched to a slightly looser tension at the shoulder.',
        },
        {
          id: crypto.randomUUID(),
          createdAt: date(10),
          position: 'Row 18 complete',
          toolSize: '5 mm hook',
          nextStep: 'Continue the back panel for 6 more rows, then join the shoulders.',
          notes: 'Keep the stitch marker in the first stitch.',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      code: 'LM-DEMO2',
      name: 'A blanket for slow mornings',
      craft: 'Crochet',
      color: 'ochre',
      yarn: 'Aran wool · Butter & rose',
      toolSize: '4.5 mm hook',
      notes: 'Sample project — colorful granny squares for a very cozy corner.',
      status: 'active',
      createdAt: date(18),
      updatedAt: date(5),
      sample: true,
      checkpoints: [
        {
          id: crypto.randomUUID(),
          createdAt: date(5),
          position: 'Square 12 · Round 4',
          toolSize: '4.5 mm hook',
          nextStep: 'Join the butter-yellow yarn and finish the border of square 12.',
          notes: 'Leave a long tail for joining the squares.',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      code: 'LM-DEMO3',
      name: 'Just-one-more-row scarf',
      craft: 'Knitting',
      color: 'sage',
      yarn: 'Merino DK · Soft sage',
      toolSize: '4 mm needles',
      notes: 'Sample project — a simple ribbed scarf for a friend.',
      status: 'active',
      createdAt: date(30),
      updatedAt: date(12),
      sample: true,
      checkpoints: [
        {
          id: crypto.randomUUID(),
          createdAt: date(12),
          position: 'Row 62 complete',
          toolSize: '4 mm needles',
          nextStep: 'Work row 63: knit 2, purl 2 to the end. The right side is facing you.',
          notes: 'There are 48 stitches on the needles.',
        },
      ],
    },
  ]
  return { format: 'loopmark', version: 1, exportedAt: new Date().toISOString(), projects }
}
