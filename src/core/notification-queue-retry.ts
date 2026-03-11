import { Config } from '../types'
import { normalizeError } from '../utils/error-handler'
import { QueueTaskContent } from './notification-queue-types'

const DEFAULT_QUEUE_BACKOFF_DELAYS = [10, 30, 60, 300, 600]
const DEFAULT_QUEUE_BATCH_SIZE = 10
const DEFAULT_QUEUE_MAX_RETRIES = 5
const DEFAULT_QUEUE_PROCESS_INTERVAL_SECONDS = 30
const DEFAULT_QUEUE_CLEANUP_HOURS = 24

export interface QueueRuntimeConfig {
  batchSize: number
  maxRetries: number
  processIntervalSeconds: number
  cleanupHours: number
}

export type QueueErrorAction = 'FAILED' | 'DOWNGRADE' | 'RETRY'

export interface QueueErrorClassification {
  action: QueueErrorAction
  normalizedError: Error
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(value!)))
}

export function getQueueRuntimeConfig(config?: Config): QueueRuntimeConfig {
  const queueConfig = config?.queue

  return {
    batchSize: clampInteger(queueConfig?.batchSize, 1, 50, DEFAULT_QUEUE_BATCH_SIZE),
    maxRetries: clampInteger(queueConfig?.maxRetries, 0, 20, DEFAULT_QUEUE_MAX_RETRIES),
    processIntervalSeconds: clampInteger(queueConfig?.processInterval, 5, 3600, DEFAULT_QUEUE_PROCESS_INTERVAL_SECONDS),
    cleanupHours: clampInteger(queueConfig?.cleanupHours, 1, 720, DEFAULT_QUEUE_CLEANUP_HOURS),
  }
}

export function isFatalQueueError(error: any): boolean {
  const errorCode = error?.code?.toString?.() || error?.retcode?.toString?.()

  if (errorCode === 'UnknownGroup' || errorCode === 'GROUP_NOT_FOUND') {
    return true
  }

  if (errorCode === 'UserBlock' || errorCode === 'BANNED') {
    return true
  }

  if (errorCode === 'PermissionDenied' || errorCode === 'NO_PERMISSION') {
    return true
  }

  return false
}

export function isQueueDowngradeError(error: any): boolean {
  const errorCode = error?.code?.toString?.() || error?.retcode?.toString?.()
  const errorMessage = error?.message?.toString?.() || ''

  return errorCode === '1200' || errorMessage.includes('1200') || Boolean(error?.requiresDowngrade)
}

export function classifyQueueError(error: unknown, content?: Pick<QueueTaskContent, 'isDowngraded'>): QueueErrorClassification {
  const normalizedError = normalizeError(error)

  if (!content?.isDowngraded && isQueueDowngradeError(error)) {
    return {
      action: 'DOWNGRADE',
      normalizedError,
    }
  }

  if (isFatalQueueError(error)) {
    return {
      action: 'FAILED',
      normalizedError,
    }
  }

  return {
    action: 'RETRY',
    normalizedError,
  }
}

export function shouldStopRetrying(retryCount: number, maxRetries: number): boolean {
  return retryCount >= Math.max(0, maxRetries)
}

export function getRetryDelaySeconds(retryCount: number, backoffDelays: number[] = DEFAULT_QUEUE_BACKOFF_DELAYS): number {
  return backoffDelays[retryCount] || backoffDelays[backoffDelays.length - 1]
}

export {
  DEFAULT_QUEUE_BACKOFF_DELAYS,
  DEFAULT_QUEUE_BATCH_SIZE,
  DEFAULT_QUEUE_MAX_RETRIES,
  DEFAULT_QUEUE_PROCESS_INTERVAL_SECONDS,
  DEFAULT_QUEUE_CLEANUP_HOURS,
}