import { describe, expect, it } from 'vitest'
import { errorText } from './ui'
import { UserFacingError } from '../domain/errors'
import { parseBackup } from '../data'

describe('user-facing error boundary', () => {
  it('redacts arbitrary exceptions and keeps one stable support code for the same failure', () => {
    const sentinel = 'private@example.invalid Bearer secret https://private.invalid/?token=secret'
    const error = new Error(sentinel)
    const display = errorText(error)
    expect(display).not.toContain(sentinel)
    expect(display).toContain('Diagnostic code: UNEXPECTED')
    expect(display).toContain('Help: support#diagnostics')
    expect(errorText(error)).toBe(display)
  })
  it('retains authored validation remedies without exposing unknown backup fields', () => {
    expect(errorText(new UserFacingError('Choose a smaller photo.'))).toBe(
      'Choose a smaller photo.',
    )
    let error: unknown
    try {
      parseBackup(
        JSON.stringify({
          format: 'loopmark',
          version: 1,
          exportedAt: new Date().toISOString(),
          projects: [],
          'private@example.invalid': 'secret',
        }),
      )
    } catch (failure) {
      error = failure
    }
    expect(error).toBeInstanceOf(UserFacingError)
    expect(errorText(error)).not.toContain('private@example.invalid')
    expect(errorText(error)).toContain('Check the file or form')
    try {
      parseBackup('{bad json')
    } catch (failure) {
      expect(errorText(failure)).toContain('not valid JSON')
    }
  })
})
