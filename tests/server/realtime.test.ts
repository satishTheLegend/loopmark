import { describe, it, expect } from 'vitest'
import { actor, createProject } from './helpers'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
describe('real authorized Realtime invalidation', () => {
  it('delivers only the active owner opaque hint and denies forged owner subscriptions', async () => {
    const a = await actor(),
      b = await actor(),
      own: unknown[] = [],
      diagnostics: unknown[] = [],
      other: unknown[] = []
    await a.client.realtime.setAuth(a.token)
    await b.client.realtime.setAuth(b.token)
    const ownChannel = a.client
      .channel('test-own-' + crypto.randomUUID())
      .on('system', {}, (message) => diagnostics.push(message))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loopmark_sync_hints',
          filter: `owner_id=eq.${a.id}`,
        },
        (event) => own.push(event.new),
      )
    const otherChannel = b.client.channel('test-forged-' + crypto.randomUUID()).on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'loopmark_sync_hints',
        filter: `owner_id=eq.${a.id}`,
      },
      (event) => other.push(event.new),
    )
    const subscribed = (channel: typeof ownChannel) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Actual local PostgreSQL subscription unavailable')),
          15000,
        )
        channel.on('system', {}, (message) => {
          if (message.extension === 'postgres_changes' && message.status === 'ok') {
            clearTimeout(timer)
            resolve()
          }
        })
        channel.subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timer)
            reject(new Error('Actual local Realtime subscription rejected'))
          }
        })
      })
    try {
      await Promise.all([subscribed(ownChannel), subscribed(otherChannel)])
      const created = await createProject(a)
      for (
        let attempt = 0;
        attempt < 100 &&
        !own.some((value) => (value as { revision: string }).revision === created.receipt.revision);
        attempt++
      )
        await wait(100)
      const current = own.find(
        (value) => (value as { revision: string }).revision === created.receipt.revision,
      )
      expect(current, JSON.stringify(diagnostics)).toMatchObject({
        owner_id: a.id,
        collection_id: a.session.collection.collectionId,
        epoch: a.session.collection.epoch,
        revision: created.receipt.revision,
      })
      for (const value of own)
        expect(Object.keys(value as object).sort()).toEqual([
          'collection_id',
          'epoch',
          'nonce',
          'owner_id',
          'revision',
        ])
      await wait(1000)
      expect(other).toHaveLength(0)
      expect(
        (await b.client.from('loopmark_sync_hints').select('*').eq('owner_id', a.id)).data,
      ).toEqual([])
      expect(
        (
          await a.client
            .from('loopmark_sync_hints')
            .update({ revision: '999' })
            .eq('owner_id', a.id)
        ).error,
      ).toBeTruthy()
    } finally {
      await a.client.removeChannel(ownChannel)
      await b.client.removeChannel(otherChannel)
    }
  })
})
