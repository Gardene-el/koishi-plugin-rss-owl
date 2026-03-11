export type QueueStatus = 'PENDING' | 'RETRY' | 'FAILED' | 'SUCCESS'

/**
 * 队列任务内容
 */
export interface QueueTaskContent {
  message: string
  originalItem?: any
  isDowngraded?: boolean
  title?: string
  description?: string
  link?: string
  pubDate?: Date
  imageUrl?: string
}

/**
 * 队列任务接口
 */
export interface QueueTask {
  id?: number
  subscribeId: string
  rssId: string
  uid: string
  guildId: string
  platform: string
  content: QueueTaskContent
  status: QueueStatus
  retryCount: number
  nextRetryTime?: Date
  createdAt: Date
  updatedAt: Date
  failReason?: string | null
}

export type NewQueueTask = Omit<QueueTask, 'id' | 'status' | 'retryCount' | 'createdAt' | 'updatedAt'>

export interface QueueStats {
  pending: number
  retry: number
  failed: number
  success: number
}