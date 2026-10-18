import { describe, expect, it } from 'vitest'
import vectors from '../../tests/fixtures/expansion/canonical-vectors.json'
import { canonicalHash, canonicalJson } from './canonical-json'
import { DomainError, safeError } from './errors'
import { errorHelp } from '../help/errors'
import {
  commandSchema,
  deletionReceiptSchema,
  parseCommand,
  parsePullPage,
  revisionSchema,
  signCommand,
  verifyCommand,
} from './schema'
import type { UnsignedCommand } from './contracts'

const command: UnsignedCommand = {
  protocolVersion: 2,
  payloadVersion: 1,
  collectionId: 'collection-1',
  epoch: 'epoch-1',
  deviceId: 'device-1',
  deviceGeneration: 'generation-1',
  sequence: '1',
  operationId: 'operation-1',
  base: null,
  kind: 'project.create',
  payload: {
    project: {
      id: 'project-1',
      code: 'CRAFT-1',
      name: 'वापसी 🧶',
      craft: 'Crochet',
      color: 'sage',
      yarn: '',
      toolSize: '4 mm',
      notes: '',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
}
describe('wire contract v2', () => {
  it('matches independently calculated Unicode/key ordering SHA-256 fixtures', async () => {
    for (const vector of vectors) {
      expect(canonicalJson(vector.input)).toBe(vector.canonical)
      expect(await canonicalHash(vector.input)).toBe(vector.sha256)
    }
    expect(await canonicalHash({ b: 2, a: 1 })).toBe(await canonicalHash({ a: 1, b: 2 }))
    expect(canonicalJson([3, 1])).toBe('[3,1]')
  })
  it('rejects non-JSON data without silently discarding information', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const input of [
      NaN,
      Infinity,
      undefined,
      { a: undefined },
      { a: () => 1 },
      new Date(),
      cycle,
      [1, , 3],
      '\ud800',
      'null\u0000character',
      { '\u0000': 'value' },
    ]) {
      expect(() => canonicalJson(input)).toThrow(DomainError)
    }
  })
  it('signs an exact envelope and rejects changes to payload, predecessor or ownership keys', async () => {
    const signed = await signCommand(command)
    expect(await verifyCommand(signed)).toEqual(signed)
    await expect(verifyCommand({ ...signed, sequence: '2' })).rejects.toMatchObject({
      detail: { code: 'OPERATION_REUSED' },
    })
    expect(() => parseCommand({ ...signed, accountId: 'attacker' })).toThrow(DomainError)
    expect(() =>
      parseCommand({ ...signed, payload: { ...signed.payload, upgraded: true } }),
    ).toThrow(DomainError)
    expect(() => parseCommand({ ...signed, protocolVersion: 1 })).toThrow(DomainError)
    expect(() => parseCommand({ ...signed, payloadVersion: 2 })).toThrow(DomainError)
    const update = await signCommand({
      ...command,
      kind: 'project.delete',
      payload: { projectId: 'project-1' },
      base: { afterOperationId: 'previous' },
    })
    await expect(verifyCommand({ ...update, base: { revision: '2' } })).rejects.toMatchObject({
      detail: { code: 'OPERATION_REUSED' },
    })
  })
  it('rejects invalid bases, reused self dependencies, huge values and invalid media', async () => {
    const signed = await signCommand(command)
    expect(commandSchema.safeParse({ ...signed, base: { revision: '0' } }).success).toBe(false)
    expect(
      commandSchema.safeParse({
        ...signed,
        kind: 'project.delete',
        payload: { projectId: 'p' },
        base: null,
      }).success,
    ).toBe(false)
    expect(
      commandSchema.safeParse({
        ...signed,
        kind: 'project.delete',
        payload: { projectId: 'p' },
        base: { afterOperationId: signed.operationId },
      }).success,
    ).toBe(false)
    expect(() => parseCommand({ ...signed, payload: { notes: 'x'.repeat(300_000) } })).toThrow(
      DomainError,
    )
  })
  it('preserves bigint revisions exactly and rejects noncanonical or out-of-range values', () => {
    expect(revisionSchema.parse('9007199254740993')).toBe('9007199254740993')
    for (const value of ['-1', '01', '1.2', '1e3', '', 'x', '9223372036854775808', 1])
      expect(revisionSchema.safeParse(value).success).toBe(false)
  })
  it('accepts an empty pull and rejects gaps, wrong epochs, duplicate and reordered receipt pages', async () => {
    const signed = await signCommand(command)
    const empty = {
      protocolVersion: 2,
      collectionId: 'c',
      epoch: 'e',
      afterCursor: '0',
      nextCursor: '0',
      hasMore: false,
      entries: [],
    }
    expect(parsePullPage(empty).entries).toEqual([])
    const receipt = {
      operationId: signed.operationId,
      sha256: signed.sha256,
      epoch: 'e',
      revision: '1',
      cursor: '1',
      resultId: 'p',
      changes: [{ kind: 'project.delete', id: 'p', revision: '1' }],
    }
    const valid = { ...empty, nextCursor: '1', entries: [receipt] }
    expect(parsePullPage(valid).nextCursor).toBe('1')
    for (const invalid of [
      { ...empty, hasMore: true },
      { ...valid, nextCursor: '2' },
      { ...valid, nextCursor: '2', entries: [{ ...receipt, cursor: '2', revision: '2' }] },
      { ...valid, entries: [receipt, receipt] },
      { ...valid, entries: [{ ...receipt, epoch: 'other' }] },
    ])
      expect(() => parsePullPage(invalid)).toThrow(DomainError)
  })
  it('deletion receipts cannot leak account or project identifiers', () => {
    const receipt = { status: 'pending', requestedAt: '2026-01-01T00:00:00.000Z' }
    expect(deletionReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(deletionReceiptSchema.safeParse({ ...receipt, accountId: 'secret' }).success).toBe(false)
  })
  it('maps unexpected failures to safe bundled recovery help', () => {
    const detail = safeError(new Error('token=secret@example.com'))
    expect(JSON.stringify(detail)).not.toContain('secret')
    expect(detail.correlationId).toBeTruthy()
    for (const help of Object.values(errorHelp)) {
      expect(help.nextAction.length).toBeGreaterThan(10)
      expect(help.helpRef).toContain('#')
    }
    expect(new DomainError('BACKUP_INVALID_JSON').detail.nextAction).toBe(
      'Choose an exported Loopmark backup.',
    )
  })
})
