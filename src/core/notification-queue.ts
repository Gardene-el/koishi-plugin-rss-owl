import { Context } from 'koishi'

import { Config } from '../types'
import { normalizeError } from '../utils/error-handler'
import { trackError } from '../utils/error-tracker'
import { createDebugWithContext, debug } from '../utils/logger'
import { DEFAULT_QUEUE_BACKOFF_DELAYS, getRetryDelaySeconds, isFatalQueueError } from './notification-queue-retry'
import { NotificationQueueSender } from './notification-queue-sender'
import { NotificationQueueStore } from './notification-queue-store'
import { NewQueueTask, QueueStats, QueueTask, QueueTaskContent } from './notification-queue-types'

export type { QueueStatus, QueueTask, QueueTaskContent } from './notification-queue-types'

/**
 * 消息发送队列管理器
 */
export class NotificationQueueManager {
  private processing = false
  private batchSize = 10

  private store: NotificationQueueStore
  private sender: NotificationQueueSender
  private backoffDelays = DEFAULT_QUEUE_BACKOFF_DELAYS

  constructor(
    private ctx: Context,
    private config: Config,
  ) {
    this.store = new NotificationQueueStore(ctx, this.batchSize)
    this.sender = new NotificationQueueSender({
      ctx,
      config,
      createTaskDebug: task => this.createTaskDebug(task),
      buildTaskLogContext: task => this.buildTaskLogContext(task),
    })
  }

  private buildTaskLogContext(task: Partial<QueueTask>): Record<string, any> {
    const context: Record<string, any> = {
      subscribeId: task.subscribeId,
      rssId: task.rssId,
      uid: task.uid,
      guildId: task.guildId,
      platform: task.platform,
      retryCount: task.retryCount,
    }

    if (task.id !== undefined) {
      context.taskId = String(task.id)
    }

    if (task.platform && task.guildId) {
      context.target = `${task.platform}:${task.guildId}`
    }

    return context
  }

  private createTaskDebug(task: Partial<QueueTask>) {
    return createDebugWithContext(this.config, this.buildTaskLogContext(task))
  }

  /**
   * 添加任务到队列
   */
  async addTask(task: NewQueueTask): Promise<QueueTask> {
    const queueTask = await this.store.createTask(task)
    const taskDebug = this.createTaskDebug(queueTask)
    taskDebug(`任务已加入队列: [${task.rssId}] ${task.content.title}`, 'queue', 'info')
    return queueTask
  }

  /**
   * 处理队列中的任务
   */
  async processQueue(): Promise<void> {
    if (this.processing) {
      debug(this.config, '队列正在处理中，跳过本次', 'queue', 'details', { processing: true })
      return
    }

    this.processing = true
    try {
      const tasks = await this.store.getPendingTasks()

      if (tasks.length === 0) {
        return
      }

      debug(this.config, `开始处理 ${tasks.length} 个待发送任务`, 'queue', 'info', { taskCount: tasks.length })

      for (const task of tasks) {
        await this.processTask(task)
      }
    } catch (err: any) {
      const normalizedError = normalizeError(err)
      debug(this.config, `队列处理异常: ${normalizedError.message}`, 'queue', 'error', { processing: true })
      trackError(normalizedError, { operation: 'processQueue' })
    } finally {
      this.processing = false
    }
  }

  /**
   * 处理单个任务
   */
  private async processTask(task: QueueTask): Promise<void> {
    const taskDebug = this.createTaskDebug(task)

    taskDebug(`处理任务 [${task.rssId}] ${task.content.title} (重试${task.retryCount}次)`, 'queue', 'details')

    try {
      await this.sender.sendMessage(task)
      await this.store.markTaskSuccess(task.id!)
      taskDebug(`✓ 任务发送成功: [${task.rssId}] ${task.content.title}`, 'queue', 'info')

      await this.sender.cacheMessage(task)
    } catch (error: any) {
      await this.handleSendError(task, error)
    }
  }

  /**
   * 处理发送错误
   */
  private async handleSendError(task: QueueTask, error: any): Promise<void> {
    const taskDebug = this.createTaskDebug(task)
    const normalizedError = normalizeError(error)
    const errorMsg = normalizedError.message || 'Unknown error'

    trackError(normalizedError, {
      ...this.buildTaskLogContext(task),
      failReason: errorMsg,
      requiresDowngrade: Boolean(error?.requiresDowngrade),
    })

    if (this.isFatalError(error)) {
      await this.store.markTaskFailed(task.id!, errorMsg)
      taskDebug(`✗ 永久性失败，放弃重试: [${task.rssId}] ${task.content.title} - ${errorMsg}`, 'queue', 'error', {
        fatal: true,
        failReason: errorMsg,
      })
      return
    }

    if (error.requiresDowngrade && !task.content.isDowngraded) {
      const downgradedContent = await this.downgradeMessage(task.content)
      await this.store.updateTaskForDowngrade(task, downgradedContent)
      taskDebug(`→ 消息已降级，立即重试: [${task.rssId}] ${task.content.title}`, 'queue', 'info', {
        requiresDowngrade: true,
      })
      return
    }

    const delay = getRetryDelaySeconds(task.retryCount, this.backoffDelays)
    const nextTime = new Date(Date.now() + delay * 1000)

    await this.store.markTaskRetry(task, nextTime, errorMsg)
    taskDebug(`→ 任务将在 ${Math.ceil(delay / 60)} 分钟后重试: [${task.rssId}] ${task.content.title}`, 'queue', 'info', {
      nextRetryTime: nextTime.toISOString(),
      failReason: errorMsg,
    })
  }

  /**
   * 判断是否为永久性错误
   */
  private isFatalError(error: any): boolean {
    return isFatalQueueError(error)
  }

  /**
   * 降级消息（移除媒体元素）
   */
  private async downgradeMessage(content: QueueTaskContent): Promise<QueueTaskContent> {
    return this.sender.downgradeMessage(content)
  }

  /**
   * 获取队列统计信息
   */
  async getStats(): Promise<QueueStats> {
    return this.store.getStats()
  }

  /**
   * 重试失败的任务
   */
  async retryFailedTasks(taskId?: number): Promise<number> {
    const resetCount = await this.store.retryFailedTasks(taskId)

    debug(this.config, `已重置 ${resetCount} 个失败任务为 PENDING 状态`, 'queue', 'info', {
      resetCount,
      taskId,
    })

    return resetCount
  }

  /**
   * 清理旧的成功任务
   */
  async cleanupSuccessTasks(olderThanHours: number = 24): Promise<number> {
    const cleanupCount = await this.store.cleanupSuccessTasks(olderThanHours)

    debug(this.config, `已清理 ${cleanupCount} 个旧的成功任务`, 'queue', 'info', {
      cleanupCount,
      olderThanHours,
    })

    return cleanupCount
  }
}
