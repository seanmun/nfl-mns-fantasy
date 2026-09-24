import { describe, expect, it } from 'vitest'
import { resultsWindow } from './resultsWindow.js'

// Real 2026 dates. Week 1's last kickoff was Monday night 2026-09-15T00:15Z
// (Sept 14, 8:15pm ET); Week 2's was 2026-09-22T00:15Z (Sept 21 ET).
const week1Last = new Date('2026-09-15T00:15:00Z')
const week2Last = new Date('2026-09-22T00:15:00Z')

describe('resultsWindow', () => {
  it('waits while the last game is still the same Eastern day', () => {
    expect(resultsWindow(week1Last, new Date('2026-09-15T03:30:00Z'))).toBe('wait') // 11:30pm ET Mon
  })

  it('waits before 8am ET on the morning after', () => {
    expect(resultsWindow(week1Last, new Date('2026-09-15T11:59:00Z'))).toBe('wait')
  })

  it('sends from 8am ET on the morning after', () => {
    expect(resultsWindow(week1Last, new Date('2026-09-15T12:00:00Z'))).toBe('send')
  })

  it('still sends one day late, for a missed tick', () => {
    expect(resultsWindow(week1Last, new Date('2026-09-16T13:00:00Z'))).toBe('send')
  })

  it('expires from the third day: never mails a week into the next one', () => {
    expect(resultsWindow(week1Last, new Date('2026-09-17T12:00:00Z'))).toBe('expired')
  })

  it('the two weeks decided late on 2026-09-24 are both expired, not sent', () => {
    const fixDeployed = new Date('2026-09-24T18:00:00Z')
    expect(resultsWindow(week1Last, fixDeployed)).toBe('expired')
    expect(resultsWindow(week2Last, fixDeployed)).toBe('expired')
  })

  it('expiry does not depend on the hour', () => {
    expect(resultsWindow(week2Last, new Date('2026-09-24T09:00:00Z'))).toBe('expired') // 5am ET
  })
})
