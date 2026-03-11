const DEFAULT_QUEUE_BACKOFF_DELAYS = [10, 30, 60, 300, 600]

export function isFatalQueueError(error: any): boolean {
  const errorCode = error?.code || error?.retcode

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

export function getRetryDelaySeconds(retryCount: number, backoffDelays: number[] = DEFAULT_QUEUE_BACKOFF_DELAYS): number {
  return backoffDelays[retryCount] || backoffDelays[backoffDelays.length - 1]
}

export { DEFAULT_QUEUE_BACKOFF_DELAYS }