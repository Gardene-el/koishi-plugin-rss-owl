import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { feeder } from '../../src/core/feeder'
import { NotificationQueueManager } from '../../src/core/notification-queue'
import { getRssData } from '../../src/core/parser'
import { Config } from '../../src/types'

jest.mock('../../src/core/parser', () => ({ getRssData: jest.fn() }))

const mockedGetRssData = getRssData as jest.MockedFunction<typeof getRssData>

function matchesQuery(record: Record<string, any>, query: Record<string, any> = {}): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = record[key]
    if (expected && typeof expected === 'object' && '$lt' in expected) {
      return new Date(actual).getTime() < new Date(expected.$lt as Date).getTime()
    }
    return actual === expected
  })
}

function createMockContext(initialSubscriptions: Record<string, any>[]) {
  const tables = {
    rssOwl: initialSubscriptions.map(item => ({ ...item })),
    rss_notification_queue: [] as Record<string, any>[],
  }
  const nextId = { rssOwl: tables.rssOwl.length + 1, rss_notification_queue: 1 }

  return {
    tables,
    ctx: {
      database: {
        get: jest.fn(async (table: 'rssOwl' | 'rss_notification_queue', query: Record<string, any> = {}, options?: { limit?: number }) => {
          const rows = tables[table].filter(row => matchesQuery(row, query))
          return options?.limit ? rows.slice(0, options.limit) : rows
        }),
        create: jest.fn(async (table: 'rssOwl' | 'rss_notification_queue', record: Record<string, any>) => {
          const created = { ...record, id: record.id ?? nextId[table]++ }
          tables[table].push(created)
          return { id: created.id }
        }),
        set: jest.fn(async (table: 'rssOwl' | 'rss_notification_queue', query: Record<string, any>, update: Record<string, any>) => {
          tables[table].forEach(row => {
            if (matchesQuery(row, query)) Object.assign(row, update)
          })
        }),
        remove: jest.fn(async (table: 'rssOwl' | 'rss_notification_queue', query: Record<string, any>) => {
          for (let index = tables[table].length - 1; index >= 0; index--) {
            if (matchesQuery(tables[table][index], query)) tables[table].splice(index, 1)
          }
        }),
      },
      broadcast: jest.fn(async () => undefined),
    } as any,
  }
}

describe('RSS 主链路集成回归', () => {
  const config: Config = {
    basic: {
      usePoster: false,
      refresh: 600,
      timeout: 60000,
      merge: '不合并',
      mergeVideo: true,
      firstLoad: true,
      urlDeduplication: true,
      resendUpdatedContent: 'latest',
      defaultTemplate: 'auto',
      imageMode: 'File',
      videoMode: 'href',
      authority: 1,
      advancedAuthority: 4,
    },
    cache: { enabled: false, maxSize: 100 },
    msg: { keywordFilter: [], keywordBlock: [], rssHubUrl: 'https://hub.slarker.me' },
    queue: { batchSize: 10, maxRetries: 3, processInterval: 30, cleanupHours: 24 },
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('应该完成 feeder -> queue -> broadcast 的 RSS 主链路', async () => {
    const pubDate = new Date('2026-03-10T10:00:00.000Z')
    const { ctx, tables } = createMockContext([{
      id: 1,
      url: 'https://example.com/rss',
      platform: 'onebot',
      guildId: 'guild-1',
      author: 'bot-1',
      rssId: 'rss-1',
      title: 'Test RSS',
      arg: { nextUpdataTime: Date.now() - 1000 },
      lastPubDate: pubDate,
      lastContent: { itemArray: [{ title: 'Item 1', description: 'Oldcontent', link: 'https://example.com/item-1', guid: 'item-1' }] },
    }])
    const processor = { parseRssItem: jest.fn(async () => '<p>rendered</p><video src="https://example.com/video.mp4"></video>') } as any
    const queueManager = new NotificationQueueManager(ctx, config)

    mockedGetRssData.mockResolvedValueOnce([{
      title: 'Item 1',
      description: 'Updated content',
      link: 'https://example.com/item-1',
      guid: 'item-1',
      pubDate,
    }])

    await feeder({ ctx, config, $http: jest.fn(), queueManager }, processor)

    expect(tables.rss_notification_queue).toHaveLength(1)
    expect(tables.rss_notification_queue[0].status).toBe('PENDING')
    expect(tables.rss_notification_queue[0].content.message).toContain('<message forward>')
    expect(tables.rssOwl[0].arg.nextUpdateTime).toBeDefined()
    expect(tables.rssOwl[0].arg.nextUpdataTime).toBe(tables.rssOwl[0].arg.nextUpdateTime)
    expect(tables.rssOwl[0].lastContent.itemArray[0].description).toBe('Updatedcontent')

    await queueManager.processQueue()

    expect(ctx.broadcast).toHaveBeenCalledWith(['onebot:guild-1'], expect.stringContaining('<message forward>'))
    expect(tables.rss_notification_queue[0].status).toBe('SUCCESS')
    expect(processor.parseRssItem).toHaveBeenCalledTimes(1)
  })
})