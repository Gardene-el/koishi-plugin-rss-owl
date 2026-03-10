import { Context } from 'koishi'
import { } from 'koishi-plugin-puppeteer'
import { } from '@koishijs/censor'

// Export types and config
export { Config } from './config'
export * from './types'
export { templateList } from './config'

import type { Config } from './types'

export const name = '@anyul/koishi-plugin-rss'

import { createHttpFunction, RequestManager } from './utils/fetcher'
import { delCache } from './utils/media'
import { initErrorTracker } from './utils/error-tracker'
import {
  createCommandRuntimeDeps,
  registerManagementCommands,
  registerSubscriptionCreateCommand,
  registerSubscriptionEditCommand,
  registerSubscriptionManagementCommands,
  registerWebMonitorCommands,
} from './commands'

// Import core modules
import { RssItemProcessor } from './core/item-processor'
import { startFeeder, stopFeeder } from './core/feeder'
import { initMessageCache } from './utils/message-cache'
import { registerMessageCacheService } from './services/message-cache-service'
import { NotificationQueueManager } from './core/notification-queue'

// Import database and constants
import { setupDatabase } from './database'
import { usage, quickList } from './constants'

export const inject = { required: ["database"], optional: ["puppeteer", "censor", "assets", "server"] }

export function apply(ctx: Context, config: Config) {
  // Setup database
  setupDatabase(ctx)

  if (config.errorTracking?.enabled) {
    initErrorTracker({
      enabled: config.errorTracking.enabled ?? false,
      dsn: config.errorTracking.dsn || '',
      environment: config.errorTracking.environment,
      release: config.errorTracking.release,
      tracesSampleRate: config.errorTracking.tracesSampleRate,
      profilesSampleRate: config.errorTracking.profilesSampleRate,
    })
  }

  // Initialize request manager and HTTP function
  const requestManager = new RequestManager(3, 2, 10)
  const $http = createHttpFunction(ctx, config, requestManager)

  // Initialize RSS item processor
  const processor = new RssItemProcessor(ctx, config, $http)
  const commandRuntime = createCommandRuntimeDeps(ctx, config, $http, processor)

  // Initialize notification queue manager
  const queueManager = new NotificationQueueManager(ctx, config)

  // Initialize message cache
  if (config.cache?.enabled) {
    initMessageCache(ctx, config, config.cache.maxSize || 100)
    // Register HTTP API service
    registerMessageCacheService(ctx)
  }

  // Lifecycle management
  ctx.on('ready', async () => {
    startFeeder(ctx, config, $http, processor, queueManager)
  })

  ctx.on('dispose', async () => {
    stopFeeder(config)
    if (config.basic.imageMode === 'File') {
      delCache(config)
    }
  })

  // ============================================
  // 子命令：订阅管理
  // ============================================

  registerSubscriptionManagementCommands({
    ctx,
    config,
    parsePubDate: commandRuntime.parsePubDate,
    parseQuickUrl: commandRuntime.parseQuickUrl,
    getRssData: commandRuntime.getRssData,
    parseRssItem: commandRuntime.parseRssItem,
    mixinArg: commandRuntime.mixinArg,
  })

  registerSubscriptionCreateCommand({
    ctx,
    config,
    usage,
    quickList,
    parseQuickUrl: commandRuntime.parseQuickUrl,
    parsePubDate: commandRuntime.parsePubDate,
    getRssData: commandRuntime.getRssData,
    parseRssItem: commandRuntime.parseRssItem,
    formatArg: commandRuntime.formatArg,
    mixinArg: commandRuntime.mixinArg,
    debug: commandRuntime.debug,
  })

  registerWebMonitorCommands({
    ctx,
    config,
    debug: commandRuntime.debug,
    mixinArg: commandRuntime.mixinArg,
    getRssData: commandRuntime.getRssData,
    parseRssItem: commandRuntime.parseRssItem,
    generateSelectorByAI: commandRuntime.generateSelectorByAI,
    fetchUrl: commandRuntime.fetchUrl,
  })

  registerSubscriptionEditCommand({
    ctx,
    config,
  })

  registerManagementCommands({
    ctx,
    config,
    queueManager,
  })
}
