import { Context } from 'koishi'

import type { Config } from '../types'
import { NotificationQueueManager } from '../core/notification-queue'
import { normalizeError } from '../utils/error-handler'
import { trackError } from '../utils/error-tracker'
import { getMessageCache, type CachedMessage, type MessageCacheManager } from '../utils/message-cache'
import { debug } from '../utils/logger'
import { buildCommandLogContext } from './utils'

/**
 * 管理类命令依赖
 */
export interface ManagementCommandDeps {
  ctx: Context
  config: Config
  queueManager: NotificationQueueManager
}

interface CacheLookupResult {
  message: CachedMessage | null
  page: number
}

/**
 * 注册管理类命令
 */
export function registerManagementCommands(deps: ManagementCommandDeps): void {
  registerCacheCommands(deps.ctx, deps.config)
  registerQueueCommands(deps.ctx, deps.config, deps.queueManager)
}

function registerCacheCommands(ctx: Context, config: Config): void {
  ctx.guild()
    .command('rssowl.cache', '消息缓存管理')
    .alias('rsso.cache')
    .usage(`
消息缓存管理功能，查看和管理已推送的 RSS 消息缓存。

用法:
  rsso.cache list [页数]              - 查看缓存消息列表
  rsso.cache search <关键词>          - 搜索缓存消息
  rsso.cache stats                    - 查看缓存统计
  rsso.cache message <序号>           - 查看消息详情
  rsso.cache pull <序号>             - 重新推送缓存消息
  rsso.cache clear                    - 清空所有缓存
  rsso.cache cleanup [保留数量]       - 清理缓存（保留最新N条）

示例:
  rsso.cache list                     - 查看第1页（每页10条）
  rsso.cache list 2                   - 查看第2页
  rsso.cache search 新闻              - 搜索包含"新闻"的消息
  rsso.cache stats                    - 查看统计信息
  rsso.cache message 1                - 查看序号1的消息详情
  rsso.cache pull 1                  - 推送序号1的消息
  rsso.cache cleanup 50               - 清理并保留最新50条

注意：序号从1开始，会在列表中显示对应的真实数据库ID
    `)
    .action(async ({ session }, subcommand, ...args) => {
      const { authority } = session.user as any
      const cache = getMessageCache()

      if (!cache) {
        return '消息缓存功能未启用，请在配置中启用 cache.enabled'
      }

      if (!subcommand) {
        return `消息缓存管理

可用指令:
  rsso.cache list [页数]              - 查看缓存消息列表
  rsso.cache search <关键词>          - 搜索缓存消息
  rsso.cache stats                    - 查看缓存统计
  rsso.cache message <序号>           - 查看消息详情
  rsso.cache pull <序号>             - 重新推送缓存消息
  rsso.cache clear                    - 清空所有缓存
  rsso.cache cleanup [保留数量]       - 清理缓存（保留最新N条）

详细信息请使用: rsso.cache --help`
      }

      const logContext = buildCommandLogContext(session as any, 'rsso.cache', subcommand)

      switch (subcommand) {
        case 'list':
          return handleCacheList(cache, args, config, logContext)
        case 'message':
          return handleCacheMessage(cache, args, config, logContext)
        case 'search':
          return handleCacheSearch(cache, args, config, logContext)
        case 'stats':
          return handleCacheStats(cache, config, logContext)
        case 'clear':
          if (authority < config.basic.authority) {
            return `权限不足！当前权限: ${authority}，需要权限: ${config.basic.authority} 或以上`
          }
          return handleCacheClear(cache, config, logContext)
        case 'cleanup':
          if (authority < config.basic.authority) {
            return `权限不足！当前权限: ${authority}，需要权限: ${config.basic.authority} 或以上`
          }
          return handleCacheCleanup(cache, args, config, logContext)
        case 'pull':
          return handleCachePull(ctx, session, cache, args, config, logContext)
        default:
          return `未知的子命令: ${subcommand}\n使用 "rsso.cache" 查看可用指令`
      }
    })
}

function registerQueueCommands(ctx: Context, config: Config, queueManager: NotificationQueueManager): void {
  ctx.guild()
    .command('rssowl.queue', '发送队列管理')
    .alias('rsso.queue')
    .usage(`
发送队列管理功能，查看和管理待发送的消息队列。

用法:
  rsso.queue stats                - 查看队列统计
  rsso.queue retry [id]            - 重试失败的任务
  rsso.queue retry --all           - 重试所有失败任务
  rsso.queue cleanup [hours]       - 清理旧的成功任务（默认24小时）

示例:
  rsso.queue stats                 - 查看队列状态
  rsso.queue retry 5               - 重试ID为5的任务
  rsso.queue retry --all           - 重试所有失败任务
  rsso.queue cleanup 48            - 清理48小时前的成功任务

说明:
  - PENDING: 待发送
  - RETRY: 等待重试
  - FAILED: 发送失败
  - SUCCESS: 发送成功
    `)
    .action(async ({ session }, subcommand, ...args) => {
      const { authority } = session.user as any

      if (!subcommand) {
        return `发送队列管理

可用指令:
  rsso.queue stats                - 查看队列统计
  rsso.queue retry [id]            - 重试失败的任务
  rsso.queue retry --all           - 重试所有失败任务
  rsso.queue cleanup [hours]       - 清理旧的成功任务（默认24小时）

详细信息请使用: rsso.queue --help`
      }

      const logContext = buildCommandLogContext(session as any, 'rsso.queue', subcommand)

      switch (subcommand) {
        case 'stats':
          return handleQueueStats(queueManager, config, logContext)
        case 'retry':
          if (authority < config.basic.authority) {
            return `权限不足！当前权限: ${authority}，需要权限: ${config.basic.authority} 或以上`
          }
          return handleQueueRetry(queueManager, args, config, logContext)
        case 'cleanup':
          if (authority < config.basic.authority) {
            return `权限不足！当前权限: ${authority}，需要权限: ${config.basic.authority} 或以上`
          }
          return handleQueueCleanup(queueManager, args, config, logContext)
        default:
          return `未知的子命令: ${subcommand}\n使用 "rsso.queue" 查看可用指令`
      }
    })
}

async function handleCacheList(cache: MessageCacheManager, args: string[], config: Config, logContext?: Record<string, any>): Promise<string> {
  const page = parseInt(args[0]) || 1
  const limit = 10
  const offset = (page - 1) * limit

  try {
    const messages = await cache.getMessages({ limit, offset })

    if (messages.length === 0) {
      return '暂无缓存消息'
    }

    const stats = await cache.getStats()
    let output = `📋 缓存消息列表 (第${page}页，共${Math.ceil(stats.totalMessages / limit)}页，总计${stats.totalMessages}条)\n\n`

    output += messages.map((msg, index) => {
      const date = new Date(msg.createdAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      })
      const title = msg.title.length > 30 ? msg.title.substring(0, 30) + '...' : msg.title
      return `${index + 1}. [ID:${msg.id}] [${msg.rssId}] ${title}\n   时间: ${date}\n   链接: ${msg.link}`
    }).join('\n\n')

    output += `\n\n💡 使用 "rsso.cache list ${page + 1}" 查看下一页`
    output += '\n💡 使用 "rsso.cache pull <序号>" 推送消息（注意：序号基于当前页）'
    output += '\n💡 使用 "rsso.cache message <序号>" 查看详情'
    return output
  } catch (error: any) {
    logCommandError(config, error, 'cache list error', { ...logContext, page, limit })
    return `获取消息列表失败: ${error.message}`
  }
}

async function handleCacheMessage(cache: MessageCacheManager, args: string[], config: Config, logContext?: Record<string, any>): Promise<string> {
  const serialNumber = parseInt(args[0])
  if (!serialNumber || serialNumber < 1) {
    return '请提供序号\n使用方法: rsso.cache message <序号>\n示例: rsso.cache message 1\n💡 提示：使用 "rsso.cache list" 查看序号'
  }

  try {
    const found = await findCachedMessageBySerial(cache, serialNumber)
    if (!found.message) {
      return `❌ 未找到序号为 ${args[0]} 的消息\n💡 使用 "rsso.cache list" 查看可用的序号`
    }

    const pubDate = new Date(found.message.pubDate).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })
    const createdAt = new Date(found.message.createdAt).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })

    let output = `📰 消息详情 (第${found.page}页序号${args[0]}，真实ID:${found.message.id})\n\n`
    output += `📰 标题: ${found.message.title}\n📡 订阅: ${found.message.rssId}\n👥 群组: ${found.message.platform}:${found.message.guildId}\n🔗 链接: ${found.message.link}\n📅 发布时间: ${pubDate}\n💾 缓存时间: ${createdAt}\n`

    if (found.message.content) {
      const content = found.message.content.length > 200 ? found.message.content.substring(0, 200) + '...' : found.message.content
      output += `\n📝 内容:\n${content}`
    }
    if (found.message.imageUrl) output += `\n\n🖼️ 图片: ${found.message.imageUrl}`
    if (found.message.videoUrl) output += `\n\n🎬 视频: ${found.message.videoUrl}`
    return output
  } catch (error: any) {
    logCommandError(config, error, 'cache message error', { ...logContext, serialNumber })
    return `获取消息详情失败: ${error.message}`
  }
}

async function handleCacheSearch(cache: MessageCacheManager, args: string[], config: Config, logContext?: Record<string, any>): Promise<string> {
  const keyword = args[0]
  if (!keyword) {
    return '请提供搜索关键词\n使用方法: rsso.cache search <关键词>'
  }

  try {
    const messages = await cache.searchMessages({ keyword, limit: 10 })
    if (messages.length === 0) {
      return `未找到包含 "${keyword}" 的消息`
    }

    let output = `🔍 搜索结果 "${keyword}" (找到${messages.length}条)\n\n`
    output += messages.map((msg, index) => {
      const date = new Date(msg.createdAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      })
      const title = msg.title.length > 30 ? msg.title.substring(0, 30) + '...' : msg.title
      return `${index + 1}. [ID:${msg.id}] [${msg.rssId}] ${title}\n   时间: ${date}`
    }).join('\n\n')

    output += '\n\n💡 使用 "rsso.cache message <真实ID>" 查看详情'
    return output
  } catch (error: any) {
    logCommandError(config, error, 'cache search error', { ...logContext, keyword })
    return `搜索失败: ${error.message}`
  }
}

async function handleCacheStats(cache: MessageCacheManager, config: Config, logContext?: Record<string, any>): Promise<string> {
  try {
    const stats = await cache.getStats()
    let output = `📊 缓存统计信息\n\n📦 总消息数: ${stats.totalMessages}\n`

    if (stats.oldestMessage) output += `📅 最早消息: ${new Date(stats.oldestMessage).toLocaleString('zh-CN')}\n`
    if (stats.newestMessage) output += `📅 最新消息: ${new Date(stats.newestMessage).toLocaleString('zh-CN')}\n`

    output += '\n📡 按订阅统计:\n'
    Object.entries(stats.bySubscription).sort(([, a], [, b]) => b - a).slice(0, 10).forEach(([rssId, count]) => {
      output += `  ${rssId}: ${count}条\n`
    })

    output += '\n👥 按群组统计:\n'
    Object.entries(stats.byGuild).sort(([, a], [, b]) => b - a).slice(0, 10).forEach(([guild, count]) => {
      output += `  ${guild}: ${count}条\n`
    })

    output += `\n⚙️ 最大缓存限制: ${cache.getMaxCacheSize()}条`
    return output
  } catch (error: any) {
    logCommandError(config, error, 'cache stats error', logContext)
    return `获取统计信息失败: ${error.message}`
  }
}

async function handleCacheClear(cache: MessageCacheManager, config: Config, logContext?: Record<string, any>): Promise<string> {
  try {
    const deletedCount = await cache.clearAll()
    return `✅ 已清空所有缓存，共删除 ${deletedCount} 条消息`
  } catch (error: any) {
    logCommandError(config, error, 'cache clear error', logContext)
    return `清空缓存失败: ${error.message}`
  }
}

async function handleCacheCleanup(cache: MessageCacheManager, args: string[], config: Config, logContext?: Record<string, any>): Promise<string> {
  const keepLatest = parseInt(args[0]) || cache.getMaxCacheSize()

  try {
    const deletedCount = await cache.cleanup({ keepLatest })
    if (deletedCount === 0) {
      return '✅ 当前缓存数量未超过限制，无需清理'
    }
    return `✅ 已清理缓存，保留最新 ${keepLatest} 条，删除 ${deletedCount} 条消息`
  } catch (error: any) {
    logCommandError(config, error, 'cache cleanup error', { ...logContext, keepLatest })
    return `清理缓存失败: ${error.message}`
  }
}

async function handleCachePull(ctx: Context, session: any, cache: MessageCacheManager, args: string[], config: Config, logContext?: Record<string, any>): Promise<string> {
  const serialNumber = parseInt(args[0])
  if (!serialNumber || serialNumber < 1) {
    return '请提供有效的序号\n使用方法: rsso.cache pull <序号>\n示例: rsso.cache pull 1\n💡 提示：使用 "rsso.cache list" 查看序号'
  }

  let found: CacheLookupResult | null = null
  const targetContext = {
    ...logContext,
    serialNumber,
  }

  try {
    found = await findCachedMessageBySerial(cache, serialNumber)
    if (!found.message) {
      return `❌ 未找到序号为 ${args[0]} 的消息\n💡 使用 "rsso.cache list" 查看可用的序号`
    }
    if (!found.message.finalMessage) {
      return '❌ 该消息没有缓存的最终消息\n💡 这条消息可能是旧版本缓存，请重新订阅后重试'
    }

    const { id: guildId } = session.event.guild as any
    const { platform } = session.event as any
    const target = `${platform}:${guildId}`
    await ctx.broadcast([target], found.message.finalMessage)
    return ''
  } catch (error: any) {
    const { id: guildId } = session.event.guild as any
    const { platform } = session.event as any
    logCommandError(config, error, 'cache pull error', {
      ...targetContext,
      guildId,
      platform,
      target: `${platform}:${guildId}`,
      cachedMessageId: found?.message?.id,
      rssId: found?.message?.rssId,
    })
    return `推送消息失败: ${error.message}`
  }
}

async function handleQueueStats(queueManager: NotificationQueueManager, config: Config, logContext?: Record<string, any>): Promise<string> {
  try {
    const stats = await queueManager.getStats()
    const total = stats.pending + stats.retry + stats.failed + stats.success
    return `📊 发送队列统计\n\n⏳ 待发送: ${stats.pending}\n🔄 等待重试: ${stats.retry}\n❌ 发送失败: ${stats.failed}\n✅ 发送成功: ${stats.success}\n\n📦 总计: ${total} 个任务`
  } catch (error: any) {
    logCommandError(config, error, 'queue stats error', logContext)
    return `获取统计信息失败: ${error.message}`
  }
}

async function handleQueueRetry(queueManager: NotificationQueueManager, args: string[], config: Config, logContext?: Record<string, any>): Promise<string> {
  try {
    const taskId = args[0]

    if (taskId === '--all') {
      const count = await queueManager.retryFailedTasks()
      return `✅ 已重置 ${count} 个失败任务为 PENDING 状态`
    }
    if (taskId) {
      const id = parseInt(taskId)
      if (isNaN(id)) {
        return `❌ 无效的任务ID: ${taskId}`
      }
      const count = await queueManager.retryFailedTasks(id)
      return count > 0 ? `✅ 已重置任务 ${id}` : `❌ 未找到任务 ${id}`
    }
    return '请指定任务ID或使用 --all 重试所有失败任务\n使用方法: rsso.queue retry <id|--all>'
  } catch (error: any) {
    logCommandError(config, error, 'queue retry error', { ...logContext, taskId: args[0] })
    return `重试失败: ${error.message}`
  }
}

async function handleQueueCleanup(queueManager: NotificationQueueManager, args: string[], config: Config, logContext?: Record<string, any>): Promise<string> {
  try {
    const hours = parseInt(args[0]) || 24
    const count = await queueManager.cleanupSuccessTasks(hours)
    if (count === 0) {
      return '✅ 没有需要清理的成功任务'
    }
    return `✅ 已清理 ${count} 个超过 ${hours} 小时的成功任务`
  } catch (error: any) {
    logCommandError(config, error, 'queue cleanup error', { ...logContext, hours: parseInt(args[0]) || 24 })
    return `清理失败: ${error.message}`
  }
}

async function findCachedMessageBySerial(
  cache: MessageCacheManager,
  serialNumber: number,
  limit = 10,
  maxPagesToSearch = 10,
): Promise<CacheLookupResult> {
  let targetSerialNumber = serialNumber

  for (let page = 1; page <= maxPagesToSearch; page++) {
    const offset = (page - 1) * limit
    const messages = await cache.getMessages({ limit, offset })

    if (messages.length === 0) break
    if (targetSerialNumber <= messages.length) {
      return { message: messages[targetSerialNumber - 1], page }
    }

    targetSerialNumber -= messages.length
  }

  return { message: null, page: 1 }
}

function logCommandError(config: Config, error: any, scope: string, context?: Record<string, any>): void {
  const normalizedError = normalizeError(error)
  debug(config, normalizedError, scope, 'error', context)
  trackError(normalizedError, context)
}

export { registerSubscriptionManagementCommands } from './subscription-management'
export { registerSubscriptionEditCommand } from './subscription-edit'
export { registerSubscriptionCreateCommand } from './subscription-create'
export { registerWebMonitorCommands } from './web-monitor'
export { createCommandRuntimeDeps } from './runtime'
