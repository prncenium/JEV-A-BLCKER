import { OPERATIONS, MESSAGE_TYPES, STEPS } from './constants.js'

const OPERATION_VALUES = Object.values(OPERATIONS)
const MESSAGE_TYPE_VALUES = Object.values(MESSAGE_TYPES)
const OUTCOMES = ['success', 'abort']

const ok = (value) => ({ ok: true, value })
const fail = (error) => ({ ok: false, error })

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isStringOrNull = (v) => v === null || typeof v === 'string'

export function validateDecision(obj) {
  try {
    if (!isObject(obj)) return fail('decision must be an object')
    if (!OPERATION_VALUES.includes(obj.operation)) return fail('unknown operation')
    if (!isStringOrNull(obj.targetId)) return fail('targetId must be a string or null')
    if (!isFiniteNumber(obj.confidence) || obj.confidence < 0 || obj.confidence > 1) {
      return fail('confidence must be a number in [0, 1]')
    }
    return ok({ operation: obj.operation, targetId: obj.targetId, confidence: obj.confidence })
  } catch {
    return fail('invalid decision')
  }
}

function validateEntry(e) {
  return (
    isObject(e) &&
    typeof e.id === 'string' &&
    typeof e.tag === 'string' &&
    isStringOrNull(e.role) &&
    isStringOrNull(e.ariaLabel) &&
    typeof e.text === 'string' &&
    typeof e.enabled === 'boolean'
  )
}

function validateDecidePayload(p) {
  if (!isObject(p)) return 'DECIDE payload must be an object'
  if (typeof p.goal !== 'string') return 'goal must be a string'
  if (!Number.isInteger(p.stepIndex) || p.stepIndex < 1 || p.stepIndex > STEPS.length) {
    return 'stepIndex must be an integer from 1 to 5'
  }
  if (!isStringOrNull(p.lastAction)) return 'lastAction must be a string or null'
  if (!Array.isArray(p.snapshot) || !p.snapshot.every(validateEntry)) {
    return 'snapshot must be an array of entries'
  }
  return null
}

function validateLogPayload(p) {
  if (!isObject(p)) return 'LOG_FLOW payload must be an object'
  if (!isFiniteNumber(p.ts)) return 'ts must be a number'
  if (!OUTCOMES.includes(p.outcome)) return 'outcome must be success or abort'
  if (typeof p.reason !== 'string') return 'reason must be a string'
  if (!isFiniteNumber(p.steps)) return 'steps must be a number'
  if (!isFiniteNumber(p.calls)) return 'calls must be a number'
  if (!isFiniteNumber(p.durationMs)) return 'durationMs must be a number'
  if (!Array.isArray(p.confidences) || !p.confidences.every(isFiniteNumber)) {
    return 'confidences must be an array of numbers'
  }
  return null
}

export function validateMessage(msg) {
  try {
    if (!isObject(msg)) return fail('message must be an object')
    if (!MESSAGE_TYPE_VALUES.includes(msg.type)) return fail('unknown message type')

    let problem = null
    if (msg.type === MESSAGE_TYPES.DECIDE) problem = validateDecidePayload(msg.payload)
    else if (msg.type === MESSAGE_TYPES.LOG_FLOW) problem = validateLogPayload(msg.payload)
    else if (msg.type === MESSAGE_TYPES.GET_CONFIG) {
      if (msg.payload !== undefined && msg.payload !== null) problem = 'GET_CONFIG takes no payload'
    }
    if (problem) return fail(problem)
    return ok({ type: msg.type, payload: msg.payload })
  } catch {
    return fail('invalid message')
  }
}
