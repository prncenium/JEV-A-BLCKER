import { describe, it, expect } from 'vitest'
import {
  OPERATIONS,
  THRESHOLDS,
  LIMITS,
  STEPS,
  STORAGE_KEYS,
  MESSAGE_TYPES
} from '../src/shared/constants.js'

describe('constants', () => {
  it('has the confidence thresholds', () => {
    expect(THRESHOLDS.ACT).toBe(0.8)
    expect(THRESHOLDS.RETRY).toBe(0.5)
  })

  it('has the limits', () => {
    expect(LIMITS.MAX_CALLS).toBe(8)
    expect(LIMITS.MAX_MS).toBe(10000)
    expect(LIMITS.MAX_SNAPSHOT).toBe(40)
    expect(LIMITS.DEBOUNCE_MS).toBe(1500)
    expect(LIMITS.CLICK_WAIT_MS).toBe(800)
    expect(LIMITS.WAIT_MS).toBe(500)
    expect(LIMITS.TEXT_MAX).toBe(80)
    expect(LIMITS.JEV_TIMEOUT_MS).toBe(3000)
  })

  it('has exactly the four operations', () => {
    expect(Object.keys(OPERATIONS).sort()).toEqual(['BLOCKED', 'CLICK', 'DONE', 'WAIT'])
    for (const [k, v] of Object.entries(OPERATIONS)) expect(v).toBe(k)
  })

  it('has exactly the three message types', () => {
    expect(Object.keys(MESSAGE_TYPES).sort()).toEqual(['DECIDE', 'GET_CONFIG', 'LOG_FLOW'])
    for (const [k, v] of Object.entries(MESSAGE_TYPES)) expect(v).toBe(k)
  })

  it('has the storage keys', () => {
    expect(STORAGE_KEYS.SETTINGS).toBe('settings')
    expect(STORAGE_KEYS.JEV_KEY).toBe('jevKey')
    expect(STORAGE_KEYS.FLOW_LOGS).toBe('flowLogs')
  })

  it('has a STEPS table with 5 entries numbered 1 to 5', () => {
    expect(STEPS).toHaveLength(5)
    expect(STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5])
    for (const s of STEPS) {
      expect(typeof s.goal).toBe('string')
      expect(s.goal.length).toBeGreaterThan(0)
    }
  })

  it('maps steps to R40 rules a to d and none for step 5', () => {
    expect(STEPS.map((s) => s.rule)).toEqual(['a', 'b', 'c', 'd', null])
  })

  it('uses the player scope for steps 1 and 5 and the iframe for 2 to 4', () => {
    expect(STEPS.map((s) => s.scope)).toEqual(['player', 'iframe', 'iframe', 'iframe', 'player'])
  })

  it('is frozen', () => {
    expect(Object.isFrozen(LIMITS)).toBe(true)
    expect(Object.isFrozen(STEPS)).toBe(true)
    expect(Object.isFrozen(OPERATIONS)).toBe(true)
  })
})
