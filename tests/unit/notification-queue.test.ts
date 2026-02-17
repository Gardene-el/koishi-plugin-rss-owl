/**
 * NotificationQueueManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { NotificationQueueManager, QueueTask, QueueTaskContent, QueueStatus } from '../../src/core/notification-queue'
import { Config } from '../../src/types'

// Mock Koishi Context
const mockCtx = {
  database: {
    create: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
  broadcast: jest.fn(),
} as any

// Mock Config
const mockConfig: Config = {
  basic: {
    refresh: 600,
    timeout: 60000,
    authority: 3,
    advancedAuthority: 4,
    imageMode: 'File',
    merge: '有多条更新时合并',
    margeVideo: true,
    firstLoad: true,
    urlDeduplication: true,
    resendUpdataContent: 'all',
    defaultTemplate: 'auto',
    videoMode: 'href',
  },
  cache: {
    enabled: true,
    maxSize: 100,
  },
} as any

describe('NotificationQueueManager', () => {
  let queueManager: NotificationQueueManager

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks()

    // 设置默认的 database mock 返回值
    mockCtx.database.get.mockResolvedValue([])
    mockCtx.database.create.mockResolvedValue({ id: 1 })
    mockCtx.database.set.mockResolvedValue(undefined)
    mockCtx.database.remove.mockResolvedValue(undefined)
    mockCtx.broadcast.mockResolvedValue(undefined)

    queueManager = new NotificationQueueManager(mockCtx, mockConfig)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('初始化', () => {
    it('应该成功创建队列管理器实例', () => {
      expect(queueManager).toBeInstanceOf(NotificationQueueManager)
    })

    it('应该正确初始化配置', () => {
      expect(queueManager).toBeDefined()
    })
  })

  describe('addTask - 添加任务到队列', () => {
    it('应该成功添加任务到队列', async () => {
      const task = {
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id-1',
        guildId: 'test-guild',
        platform: 'onebot',
        content: {
          message: 'Test message',
          title: 'Test Title',
          description: 'Test description',
          link: 'https://example.com',
          pubDate: new Date(),
        } as QueueTaskContent,
      }

      mockCtx.database.create.mockResolvedValueOnce({ id: 1 })

      const result = await queueManager.addTask(task)

      expect(mockCtx.database.create).toHaveBeenCalledWith(
        'rss_notification_queue',
        expect.objectContaining({
          subscribeId: '123',
          rssId: 'test-rss',
          uid: 'unique-id-1',
          status: 'PENDING',
          retryCount: 0,
        })
      )
    })

    it('应该设置默认值', async () => {
      const task = {
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id-2',
        guildId: 'test-guild',
        platform: 'onebot',
        content: { message: 'Test' } as QueueTaskContent,
      }

      mockCtx.database.create.mockResolvedValueOnce({ id: 2 })

      await queueManager.addTask(task)

      const callArgs = mockCtx.database.create.mock.calls[0][1]
      expect(callArgs.status).toBe('PENDING')
      expect(callArgs.retryCount).toBe(0)
      expect(callArgs.createdAt).toBeInstanceOf(Date)
      expect(callArgs.updatedAt).toBeInstanceOf(Date)
    })
  })

  describe('isFatalError - 判断永久性错误', () => {
    it('应该识别群组不存在错误', () => {
      const error = { code: 'UnknownGroup' }
      expect(queueManager['isFatalError'](error)).toBe(true)
    })

    it('应该识别群组未找到错误', () => {
      const error = { code: 'GROUP_NOT_FOUND' }
      expect(queueManager['isFatalError'](error)).toBe(true)
    })

    it('应该识别用户被封禁错误', () => {
      const error = { code: 'UserBlock' }
      expect(queueManager['isFatalError'](error)).toBe(true)
    })

    it('应该识别账号被封禁错误', () => {
      const error = { code: 'BANNED' }
      expect(queueManager['isFatalError'](error)).toBe(true)
    })

    it('应该识别权限不足错误', () => {
      const error = { code: 'PermissionDenied' }
      expect(queueManager['isFatalError'](error)).toBe(true)
    })

    it('应该识别无权限错误', () => {
      const error = { code: 'NO_PERMISSION' }
      expect(queueManager['isFatalError'](error)).toBe(true)
    })

    it('应该识别网络超时为暂时性错误', () => {
      const error = { code: 'ETIMEDOUT' }
      expect(queueManager['isFatalError'](error)).toBe(false)
    })

    it('应该识别连接被拒绝为暂时性错误', () => {
      const error = { code: 'ECONNREFUSED' }
      expect(queueManager['isFatalError'](error)).toBe(false)
    })

    it('应该识别未知错误为暂时性错误', () => {
      const error = { code: 'UNKNOWN_ERROR' }
      expect(queueManager['isFatalError'](error)).toBe(false)
    })

    it('应该处理没有 code 字段的错误', () => {
      const error = { message: 'Some error' }
      expect(queueManager['isFatalError'](error)).toBe(false)
    })
  })

  describe('downgradeMessage - 降级消息处理', () => {
    it('应该移除 video 元素并保留链接', async () => {
      const content: QueueTaskContent = {
        message: '<p>Some text</p><video src="https://example.com/video.mp4" controls></video><p>More text</p>',
        isDowngraded: false,
      }

      const result = await queueManager['downgradeMessage'](content)

      expect(result.message).not.toContain('<video')
      expect(result.message).toContain('🎬 视频: https://example.com/video.mp4')
      expect(result.isDowngraded).toBe(true)
    })

    it('应该移除多个 video 元素', async () => {
      const content: QueueTaskContent = {
        message: '<video src="video1.mp4"></video><video src="video2.mp4"></video>',
        isDowngraded: false,
      }

      const result = await queueManager['downgradeMessage'](content)

      expect(result.message).not.toContain('<video')
      expect(result.message.split('🎬 视频:').length).toBe(3) // 包含2个视频链接
    })

    it('应该处理没有 src 属性的 video 元素', async () => {
      const content: QueueTaskContent = {
        message: '<video>Content</video>',
        isDowngraded: false,
      }

      const result = await queueManager['downgradeMessage'](content)

      expect(result.message).toContain('[视频不支持]')
      expect(result.isDowngraded).toBe(true)
    })

    it('应该保留其他内容不变', async () => {
      const content: QueueTaskContent = {
        message: '<p>Hello</p><img src="image.jpg"/><video src="video.mp4"></video>',
        isDowngraded: false,
      }

      const result = await queueManager['downgradeMessage'](content)

      expect(result.message).toContain('<p>Hello</p>')
      expect(result.message).toContain('<img src="image.jpg"/>')
    })

    it('应该处理已降级的消息', async () => {
      const content: QueueTaskContent = {
        message: 'Already downgraded message',
        isDowngraded: true,
      }

      const result = await queueManager['downgradeMessage'](content)

      expect(result.message).toBe('Already downgraded message')
      expect(result.isDowngraded).toBe(true)
    })
  })

  describe('getStats - 获取队列统计', () => {
    it('应该正确统计各种状态的任务', async () => {
      const mockTasks = [
        { status: 'PENDING' },
        { status: 'PENDING' },
        { status: 'RETRY' },
        { status: 'FAILED' },
        { status: 'SUCCESS' },
        { status: 'SUCCESS' },
      ]

      mockCtx.database.get.mockResolvedValueOnce(mockTasks)

      const stats = await queueManager.getStats()

      expect(stats.pending).toBe(2)
      expect(stats.retry).toBe(1)
      expect(stats.failed).toBe(1)
      expect(stats.success).toBe(2)
    })

    it('应该处理空队列', async () => {
      mockCtx.database.get.mockResolvedValueOnce([])

      const stats = await queueManager.getStats()

      expect(stats.pending).toBe(0)
      expect(stats.retry).toBe(0)
      expect(stats.failed).toBe(0)
      expect(stats.success).toBe(0)
    })
  })

  describe('retryFailedTasks - 重试失败任务', () => {
    it('应该重置指定任务为 PENDING 状态', async () => {
      const mockTasks = [{ id: 5, status: 'FAILED', retryCount: 3 }]
      mockCtx.database.get.mockResolvedValueOnce(mockTasks)
      mockCtx.database.set.mockResolvedValueOnce(undefined)

      const count = await queueManager.retryFailedTasks(5)

      expect(mockCtx.database.set).toHaveBeenCalledWith(
        'rss_notification_queue',
        { id: 5 },
        expect.objectContaining({
          status: 'PENDING',
          retryCount: 0,
          failReason: null,
        })
      )
      expect(count).toBe(1)
    })

    it('应该重置所有失败任务', async () => {
      const mockTasks = [
        { id: 1, status: 'FAILED' },
        { id: 2, status: 'FAILED' },
        { id: 3, status: 'FAILED' },
      ]
      mockCtx.database.get.mockResolvedValueOnce(mockTasks)
      mockCtx.database.set.mockResolvedValue(undefined)

      const count = await queueManager.retryFailedTasks()

      expect(mockCtx.database.set).toHaveBeenCalledTimes(3)
      expect(count).toBe(3)
    })

    it('应该处理没有失败任务的情况', async () => {
      mockCtx.database.get.mockResolvedValueOnce([])

      const count = await queueManager.retryFailedTasks()

      expect(mockCtx.database.set).not.toHaveBeenCalled()
      expect(count).toBe(0)
    })

    it('应该只选择失败状态的任务', async () => {
      const mockTasks = [
        { id: 1, status: 'FAILED' },
        { id: 2, status: 'PENDING' },
        { id: 3, status: 'SUCCESS' },
        { id: 4, status: 'FAILED' },
      ]
      mockCtx.database.get.mockResolvedValueOnce(mockTasks)
      mockCtx.database.set.mockResolvedValue(undefined)

      const count = await queueManager.retryFailedTasks()

      expect(count).toBe(2) // 只重试 FAILED 状态的任务
    })
  })

  describe('cleanupSuccessTasks - 清理成功任务', () => {
    it('应该清理指定时间之前的成功任务', async () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000) // 25小时前
      const recentDate = new Date(Date.now() - 10 * 60 * 60 * 1000) // 10小时前

      const mockTasks = [
        { id: 1, status: 'SUCCESS', updatedAt: oldDate },
        { id: 2, status: 'SUCCESS', updatedAt: recentDate },
      ]

      mockCtx.database.get.mockImplementationOnce((table: any, query: any) => {
        // 模拟查询逻辑：只返回超过24小时的任务
        if (query && query.updatedAt && query.updatedAt.$lt) {
          return Promise.resolve([mockTasks[0]])
        }
        return Promise.resolve([])
      })

      mockCtx.database.remove.mockResolvedValue(undefined)

      const count = await queueManager.cleanupSuccessTasks(24)

      expect(mockCtx.database.remove).toHaveBeenCalledWith('rss_notification_queue', { id: 1 })
      expect(count).toBe(1)
    })

    it('应该处理没有需要清理的任务', async () => {
      mockCtx.database.get.mockResolvedValueOnce([])

      const count = await queueManager.cleanupSuccessTasks(24)

      expect(mockCtx.database.remove).not.toHaveBeenCalled()
      expect(count).toBe(0)
    })

    it('应该使用默认24小时', async () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000)
      const mockTasks = [{ id: 1, status: 'SUCCESS', updatedAt: oldDate }]

      mockCtx.database.get.mockResolvedValueOnce(mockTasks)
      mockCtx.database.remove.mockResolvedValue(undefined)

      await queueManager.cleanupSuccessTasks() // 不传参数

      expect(mockCtx.database.remove).toHaveBeenCalled()
    })
  })

  describe('processQueue - 处理队列', () => {
    it('应该处理 PENDING 状态的任务', async () => {
      const task: QueueTask = {
        id: 1,
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id',
        guildId: 'test-guild',
        platform: 'onebot',
        content: { message: 'Test' } as QueueTaskContent,
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Mock 第一个 get 返回 PENDING 任务
      mockCtx.database.get.mockResolvedValueOnce([task])
      // Mock 第二个 get 返回 RETRY 任务（空）
      mockCtx.database.get.mockResolvedValueOnce([])

      mockCtx.broadcast.mockResolvedValueOnce(undefined)
      mockCtx.database.set.mockResolvedValueOnce(undefined)

      await queueManager.processQueue()

      expect(mockCtx.broadcast).toHaveBeenCalledWith(['onebot:test-guild'], 'Test')
      expect(mockCtx.database.set).toHaveBeenCalledWith(
        'rss_notification_queue',
        { id: 1 },
        expect.objectContaining({ status: 'SUCCESS' })
      )
    })

    it('应该处理到达重试时间的 RETRY 状态任务', async () => {
      const pastTime = new Date(Date.now() - 1000)
      const task: QueueTask = {
        id: 2,
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id',
        guildId: 'test-guild',
        platform: 'onebot',
        content: { message: 'Retry Test' } as QueueTaskContent,
        status: 'RETRY',
        retryCount: 1,
        nextRetryTime: pastTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Mock PENDING 返回空
      mockCtx.database.get.mockResolvedValueOnce([])
      // Mock RETRY 返回任务
      mockCtx.database.get.mockResolvedValueOnce([task])

      mockCtx.broadcast.mockResolvedValueOnce(undefined)
      mockCtx.database.set.mockResolvedValue(undefined)

      await queueManager.processQueue()

      expect(mockCtx.broadcast).toHaveBeenCalledWith(['onebot:test-guild'], 'Retry Test')
    })

    it('不应该处理未到达重试时间的 RETRY 状态任务', async () => {
      const futureTime = new Date(Date.now() + 60000) // 1分钟后
      const task: QueueTask = {
        id: 3,
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id',
        guildId: 'test-guild',
        platform: 'onebot',
        content: { message: 'Future Test' } as QueueTaskContent,
        status: 'RETRY',
        retryCount: 1,
        nextRetryTime: futureTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Mock PENDING 返回空
      mockCtx.database.get.mockResolvedValueOnce([])
      // Mock RETRY 返回任务（但未到重试时间）
      mockCtx.database.get.mockResolvedValueOnce([task])

      await queueManager.processQueue()

      expect(mockCtx.broadcast).not.toHaveBeenCalled()
    })

    it('应该处理发送失败的情况', async () => {
      const task: QueueTask = {
        id: 4,
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id',
        guildId: 'test-guild',
        platform: 'onebot',
        content: { message: 'Failed Test' } as QueueTaskContent,
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockCtx.database.get.mockResolvedValueOnce([task])
      mockCtx.database.get.mockResolvedValueOnce([])
      mockCtx.broadcast.mockRejectedValueOnce(new Error('Network timeout'))
      mockCtx.database.set.mockResolvedValue(undefined)

      await queueManager.processQueue()

      expect(mockCtx.database.set).toHaveBeenCalled()
      expect(mockCtx.database.set).toHaveBeenCalledWith(
        'rss_notification_queue',
        { id: 4 },
        expect.objectContaining({
          status: 'RETRY',
          retryCount: expect.any(Number),
        })
      )
    })

    it('应该处理媒体格式错误并降级重试', async () => {
      const task: QueueTask = {
        id: 5,
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id',
        guildId: 'test-guild',
        platform: 'onebot',
        content: {
          message: '<video src="video.mp4"></video>',
          isDowngraded: false,
        } as QueueTaskContent,
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mediaError = new Error('OneBot retcode 1200') as any
      mediaError.code = '1200'
      mediaError.isMediaError = true
      mediaError.requiresDowngrade = true

      mockCtx.database.get.mockResolvedValueOnce([task])
      mockCtx.database.get.mockResolvedValueOnce([])
      mockCtx.broadcast.mockRejectedValueOnce(mediaError)
      mockCtx.database.set.mockResolvedValue(undefined)

      await queueManager.processQueue()

      expect(mockCtx.database.set).toHaveBeenCalled()
      expect(mockCtx.database.set).toHaveBeenCalledWith(
        'rss_notification_queue',
        { id: 5 },
        expect.objectContaining({
          content: expect.objectContaining({
            isDowngraded: true,
          }),
          status: 'RETRY',
        })
      )
    })

    it('应该处理永久性错误', async () => {
      const task: QueueTask = {
        id: 6,
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-id',
        guildId: 'test-guild',
        platform: 'onebot',
        content: { message: 'Fatal Test' } as QueueTaskContent,
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const fatalError = new Error('UnknownGroup') as any
      fatalError.code = 'UnknownGroup'

      mockCtx.database.get.mockResolvedValueOnce([task])
      mockCtx.database.get.mockResolvedValueOnce([])
      mockCtx.broadcast.mockRejectedValueOnce(fatalError)
      mockCtx.database.set.mockResolvedValue(undefined)

      await queueManager.processQueue()

      expect(mockCtx.database.set).toHaveBeenCalled()
      expect(mockCtx.database.set).toHaveBeenCalledWith(
        'rss_notification_queue',
        { id: 6 },
        expect.objectContaining({
          status: 'FAILED',
          failReason: expect.any(String),
        })
      )
    })

    it('应该防止并发处理', async () => {
      // 设置处理标志
      queueManager['processing'] = true

      await queueManager.processQueue()

      // 不应该调用 database.get，因为已经在处理中
      expect(mockCtx.database.get).not.toHaveBeenCalled()
    })
  })

  describe('指数退避算法', () => {
    it('应该正确计算退避时间', async () => {
      const delays = [10, 30, 60, 300, 600] // 秒

      for (let i = 0; i < delays.length; i++) {
        const task: QueueTask = {
          id: i + 10,
          subscribeId: '123',
          rssId: 'test-rss',
          uid: `unique-${i}`,
          guildId: 'test-guild',
          platform: 'onebot',
          content: { message: `Test ${i}` } as QueueTaskContent,
          status: 'PENDING',
          retryCount: i,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        mockCtx.database.get.mockResolvedValueOnce([task])
        mockCtx.broadcast.mockRejectedValueOnce(new Error('Network error'))
        mockCtx.database.set.mockImplementationOnce((table, query, update) => {
          if (update.nextRetryTime) {
            const expectedDelay = delays[i] * 1000
            const actualDelay = new Date(update.nextRetryTime).getTime() - Date.now()
            // 允许 1 秒误差
            expect(Math.abs(actualDelay - expectedDelay)).toBeLessThan(1000)
          }
          return Promise.resolve(undefined)
        })

        await queueManager.processQueue()
      }
    })

    it('应该使用最大退避时间（10分钟）当重试次数超过限制', async () => {
      const task: QueueTask = {
        id: 20,
        subscribeId: '123',
        rssId: 'test-rss',
        uid: 'unique-max',
        guildId: 'test-guild',
        platform: 'onebot',
        content: { message: 'Max Test' } as QueueTaskContent,
        status: 'PENDING',
        retryCount: 10, // 超过数组长度
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockCtx.database.get.mockResolvedValueOnce([task])
      mockCtx.database.get.mockResolvedValueOnce([])
      mockCtx.broadcast.mockRejectedValueOnce(new Error('Network error'))
      mockCtx.database.set.mockResolvedValue(undefined)

      await queueManager.processQueue()

      expect(mockCtx.database.set).toHaveBeenCalled()
      expect(mockCtx.database.set).toHaveBeenCalledWith(
        'rss_notification_queue',
        { id: 20 },
        expect.objectContaining({
          status: 'RETRY',
          nextRetryTime: expect.any(Date),
        })
      )

      // 验证退避时间约为 10 分钟
      const callArgs = mockCtx.database.set.mock.calls[0][2]
      const expectedDelay = 600 * 1000 // 10分钟
      const actualDelay = new Date(callArgs.nextRetryTime).getTime() - Date.now()

      expect(Math.abs(actualDelay - expectedDelay)).toBeLessThan(1000)
    })
  })
})
