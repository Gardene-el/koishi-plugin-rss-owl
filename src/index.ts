import { Context, Session, Logger, Schema, h, clone } from 'koishi'
import { } from 'koishi-plugin-puppeteer'
import { } from '@koishijs/censor'

// Export types and config
export { Config } from './config'
export * from './types'
export { templateList } from './config'

import type { Config } from './types'

export const name = '@anyul/koishi-plugin-rss'

// Import utilities
import { debug } from './utils/logger'
import { createHttpFunction, RequestManager } from './utils/fetcher'
import { parsePubDate, ensureUrlProtocol, parseQuickUrl, parseTemplateContent, cleanContent } from './utils/common'
import { getImageUrl, getVideoUrl, puppeteerToFile, writeCacheFile, delCache, getCacheDir } from './utils/media'
import { getDefaultTemplate, getDescriptionTemplate } from './utils/template'
import { getFriendlyErrorMessage } from './utils/error-handler'
import { initErrorTracker } from './utils/error-tracker'
import { registerManagementCommands, registerSubscriptionEditCommand, registerSubscriptionManagementCommands } from './commands'

// Import core modules
import { getAiSummary, generateSelectorByAI } from './core/ai'
import { getRssData } from './core/parser'
import { renderHtml2Image, preprocessHtmlImages } from './core/renderer'
import { RssItemProcessor } from './core/item-processor'
import { startFeeder, stopFeeder, formatArg, mixinArg, findRssItem, getLastContent } from './core/feeder'
import { initMessageCache } from './utils/message-cache'
import { registerMessageCacheService } from './services/message-cache-service'
import { NotificationQueueManager } from './core/notification-queue'

// Import database and constants
import { setupDatabase } from './database'
import { usage, quickList } from './constants'

const logger = new Logger('rss-owl')
const X2JS = require("x2js")
const x2js = new X2JS()

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

  // Helper functions for commands
  const debugLocal = (message: any, name = '', type: "disable" | "error" | "info" | "details" = 'details') => {
    debug(config, message, name, type)
  }

  // Frequently used helper functions
  const parseQuickUrlLocal = (url: string) =>
    parseQuickUrl(url, config.msg.rssHubUrl, quickList)

  const parsePubDateLocal = (pubDate: any) =>
    parsePubDate(config, pubDate)

  const getRssDataLocal = async (url: string, arg: any) =>
    getRssData(ctx, config, $http, url, arg)

  const parseRssItem = async (item: any, arg: any, authorId: string | number) =>
    processor.parseRssItem(item, arg, authorId)

  const formatArgLocal = (options: any) =>
    formatArg(options, config)

  const mixinArgLocal = (arg: any) =>
    mixinArg(arg, config)

  const findRssItemLocal = (rssList: any[], keyword: number | string) =>
    findRssItem(rssList, keyword)

  const generateSelectorByAILocal = async (url: string, instruction: string, html: string) =>
    generateSelectorByAI(config, url, instruction, html)

  // ============================================
  // 子命令：订阅管理
  // ============================================

  registerSubscriptionManagementCommands({
    ctx,
    config,
    parsePubDate: parsePubDateLocal,
    parseQuickUrl: parseQuickUrlLocal,
    getRssData: getRssDataLocal,
    parseRssItem,
    mixinArg: mixinArgLocal,
  })

  // ============================================
  // 主命令：添加订阅
  // ============================================

  // Register commands
  ctx.guild()
    .command('rssowl <url:text>', '订阅 RSS/源')
    .alias('rsso')
    .usage(usage)
    .option('list', '-l [content] 查看订阅列表(详情) [已移至 rsso.list 子命令，使用列表序号]')
    .option('remove', '-r <序号> 删除订阅 [已移至 rsso.remove 子命令，使用列表序号]')
    .option('removeAll', '删除全部订阅 [已移至 rsso.remove --all 子命令]')
    .option('follow', '-f <序号> 关注订阅 [已移至 rsso.follow 子命令，使用列表序号]')
    .option('followAll', '<序号> 在该订阅更新时提醒所有人 [已移至 rsso.follow --all 子命令，使用列表序号]')
    .option('target', '--target <platform:guildId> 跨群订阅（高级权限）')
    .option('arg', '-a <content> 自定义配置')
    .option('template', '-i <content> 消息模板')
    .option('title', '-t <content> 自定义命名')
    .option('pull', '-p <序号> 拉取订阅最新更新 [已移至 rsso.pull 子命令，使用列表序号]')
    .option('force', '强行写入')
    .option('daily', '-d <content>')
    .option('test', '-T 测试')
    .option('quick', '-q [content] 查询快速订阅列表')
    .example('rsso https://hub.slarker.me/qqorw')
    .action(async ({ session, options }, url) => {
      debugLocal(options, 'options', 'info')

      const { id: guildId } = session.event.guild as any
      const { platform } = session.event as any
      const { id: userId } = session.event.user as any
      const { authority } = session.user as any
      // 获取 bot selfId 用于后续推送
      const botSelfId = session.bot?.selfId

      debugLocal(`${platform}:${userId}:${guildId}, bot:${botSelfId}`, '', 'info')
      if (options?.quick === '') {
        return '输入 rsso -q [id] 查询详情\n' + quickList.map((v, i) => `${i + 1}.${v.name}`).join('\n')
      }
      if (options?.quick) {
        let correntQuickObj = quickList[parseInt(options?.quick) - 1]
        return `${correntQuickObj.name}\n${correntQuickObj.detail}\n例:rsso -T ${correntQuickObj.example}\n(${parseQuickUrlLocal(correntQuickObj.example)})`
      }
      if ((platform.indexOf("sandbox") + 1) && !options.test && url) {
        session.send('沙盒中无法推送更新，但RSS依然会被订阅，建议使用 -T 选项进行测试')
      }

      const rssList = await ctx.database.get(('rssOwl' as any), { platform, guildId })

      if (options?.list === '' || options?.list) {
        return `💡 提示：请使用子命令查看订阅\n\nrsso.list              - 查看所有订阅（显示序号）\nrsso.list 1            - 查看订阅详情\n\n（旧选项 -l 仍可使用，但建议迁移到新命令）`
      }

      if (options?.remove) {
        return `💡 提示：请使用子命令删除订阅\n\nrsso.remove 1           - 删除订阅 #1（使用列表序号）\nrsso.remove --all       - 删除全部订阅\n\n（旧选项 -r 仍可使用，但建议迁移到新命令）`
      }

      if (options?.removeAll) {
        return `💡 提示：请使用子命令删除订阅\n\nrsso.remove --all       - 删除全部订阅\n\n（旧选项仍可使用，但建议迁移到新命令）`
      }

      if (options?.follow) {
        return `💡 提示：请使用子命令关注订阅\n\nrsso.follow 1           - 关注订阅 #1（使用列表序号）\n\n（旧选项 -f 仍可使用，但建议迁移到新命令）`
      }

      if (options?.followAll) {
        return `💡 提示：请使用子命令设置全员提醒\n\nrsso.follow 1 --all     - 设置全员提醒（使用列表序号）\n\n（旧选项仍可使用，但建议迁移到新命令）`
      }

      if (options?.pull) {
        return `💡 提示：请使用子命令拉取订阅\n\nrsso.pull 1             - 拉取订阅 #1 的最新更新（使用列表序号）\n\n（旧选项 -p 仍可使用，但建议迁移到新命令）`
      }

      if (url) {
        if (rssList.find(i => i.url == url)) return '该订阅已存在'
        let rawArg = formatArgLocal(options)
        let arg = mixinArgLocal(rawArg)
        let targetPlatform = platform
        let targetGuildId = guildId
        if (options?.target) {
          if (authority >= config.basic.advancedAuthority) {
            let target = options.target.split(/[:：]/)
            if (target.length == 1) {
              return '请输入正确的群号，格式为 platform:guildId 或 platform：guildId\n示例: onebot:123456'
            }
            targetPlatform = target[0]
            targetGuildId = target[1]

            // 测试模式：发送验证消息到目标群组
            if (options.test) {
              try {
                await ctx.broadcast([`${targetPlatform}:${targetGuildId}`], '📤 跨群订阅测试消息')
                return `✅ 测试消息已发送到目标群组\n目标: ${targetPlatform}:${targetGuildId}\n\n说明：Bot 可以访问该群组，跨群订阅可以正常工作。\n去掉 --test 选项完成订阅。`
              } catch (error: any) {
                return `❌ 无法发送到目标群组\n目标: ${targetPlatform}:${targetGuildId}\n错误: ${error.message}\n\n请确认：\n1. Bot 是否在该群组中\n2. 群组ID 是否正确\n3. 平台名称是否正确（如 onebot, telegram 等）`
              }
            }
          } else {
            return `权限不足！当前权限: ${authority}，需要权限: ${config.basic.advancedAuthority} 或以上`
          }
        }
        let title = options?.title || ""
        let rssItemList = []
        try {
          url = parseQuickUrlLocal(url)
          rssItemList = await getRssDataLocal(ensureUrlProtocol(url), arg)
          if (options.test) {
            let testItem = rssItemList[0]
            if (!testItem) return '未获取到数据'
            // 应用默认模板配置（如果没有指定模板）
            let testArg = { ...arg, url: title || testItem.rss.channel.title, title: title || testItem.rss.channel.title }
            if (!testArg.template) {
              testArg.template = config.basic.defaultTemplate
            }
            let msg = await parseRssItem(testItem, testArg, userId)
            return msg
          }
          if (!title) {
            title = rssItemList[0]?.rss.channel.title
            if (!title) return '无法获取标题，请使用 -t 指定标题'
          }
          let lastPubDate = parsePubDateLocal(rssItemList[0]?.pubDate)
          let rssItem: any = {
            url,
            platform: targetPlatform,
            guildId: targetGuildId,
            author: botSelfId,
            rssId: rssItemList[0]?.rss?.channel?.title ? rssItemList[0].rss.channel.title : title,
            arg: rawArg,
            title,
            lastPubDate,
            lastContent: [],
            followers: []
          }
          if (options.force) {
            if (authority < config.basic.authority) return `权限不足！当前权限: ${authority}，需要权限: ${config.basic.authority} 或以上`
          } else {
            if (config.basic.urlDeduplication && rssList.find(i => i.rssId == rssItem.rssId)) return `订阅已存在: ${rssItem.rssId}`
          }
          await ctx.database.create(('rssOwl' as any), rssItem)
          if (config.basic.firstLoad && arg.firstLoad !== false && rssItemList.length > 0) {
            let itemArray = rssItemList.sort((a, b) => parsePubDateLocal(b.pubDate).getTime() - parsePubDateLocal(a.pubDate).getTime())
            if (arg.reverse) itemArray = itemArray.reverse()
            const maxItem = arg.forceLength || 1
            // 使用合并后的配置来确保图片/视频模式生效
            const mergedArg = mixinArgLocal(rssItem.arg)
            let messageList = await Promise.all(itemArray.filter((v, i) => i < maxItem).map(async i => await parseRssItem(i, { ...rssItem, ...mergedArg }, rssItem.author)))
            let message = messageList.join("")
            await ctx.broadcast([`${targetPlatform}:${targetGuildId}`], message)
          }
          return `订阅成功: ${title}`
        } catch (error) {
          debugLocal(error, 'add error', 'error')
          return `订阅失败: ${getFriendlyErrorMessage(error, '添加订阅')}`
        }
      }
      return usage
    })

  // HTML monitoring command
  ctx.guild()
    .command('rssowl.html <url:string>', '监控网页变化 (CSS Selector)')
    .alias('rsso.html')
    .usage(`
HTML 网页监控功能，使用 CSS 选择器提取内容
用法:
  rsso.html https://example.com -s ".item"                    - 监控网页变化
  rsso.html https://example.com -s ".item" -T                  - 测试选择器
  rsso.html https://example.com -s ".item" -t "我的订阅"       - 自定义标题
  rsso.html https://example.com -s ".item" -P                  - SPA 动态页面
  rsso.html https://example.com -s ".item" -w 5000             - 渲染后等待5秒

示例:
  rsso.html https://www.zhihu.com/billboard -s ".BillBoard-item:first-child"
  rsso.html https://news.ycombinator.com -s ".titleline > a"
    `)
    .option('selector', '-s <选择器> CSS 选择器 (必填)')
    .option('title', '-t <标题> 自定义订阅标题')
    .option('template', '-i <模板> 消息模板 (推荐 content)')
    .option('text', '--text 只提取纯文本')
    .option('puppeteer', '-P 使用 Puppeteer 渲染 (适用于SPA)')
    .option('wait', '-w <毫秒> 渲染后等待时间')
    .option('waitSelector', '-W <选择器> 等待特定元素出现')
    .option('test', '-T 测试抓取结果 (不创建订阅)')
    .example('rsso.html https://news.ycombinator.com -s ".titleline > a"')
    .action(async ({ session, options }, url) => {
      if (!url) return '请输入 URL'
      if (!options.selector) return '请指定 CSS 选择器 (-s)'

      const { id: guildId } = session.event.guild as any
      const { platform } = session.event as any
      const { id: userId } = session.event.user as any
      // 获取 bot selfId 用于后续推送
      const botSelfId = session.bot?.selfId

      url = ensureUrlProtocol(url)
      let rawArg: any = {
        type: 'html' as const,
        selector: options.selector,
        template: options.template || 'content',
        textOnly: !!options.text,
        mode: options.puppeteer ? 'puppeteer' : 'static',
        waitFor: options.wait ? parseInt(options.wait) : undefined,
        waitSelector: options.waitSelector,
        title: options.title
      }
      let arg = mixinArgLocal(rawArg)

      try {
        // Test mode: just preview the data
        if (options.test) {
          let items = await getRssDataLocal(url, arg)
          if (!items || items.length === 0) return '未找到符合选择器的元素'
          let preview = items.slice(0, 3).map((item: any) =>
            `标题: ${item.title}\n内容: ${item.description?.substring(0, 100)}...`
          ).join('\n\n')
          return `找到 ${items.length} 个元素:\n\n${preview}`
        }

        // Full subscription flow (similar to RSS subscription)
        const rssList = await ctx.database.get(('rssOwl' as any), { platform, guildId })

        // Check if subscription already exists
        if (rssList.find(i => i.url == url)) {
          return '该订阅已存在'
        }

        // Get HTML monitoring data
        let htmlItems = await getRssDataLocal(url, arg)
        if (!htmlItems || htmlItems.length === 0) {
          return '未找到符合选择器的元素，无法创建订阅'
        }

        // Determine title
        let title = options?.title || htmlItems[0]?.rss?.channel?.title || `HTML监控: ${url}`

        // Create subscription record
        let rssItem: any = {
          url,
          platform,
          guildId,
          author: botSelfId,
          rssId: title, // Use title as rssId for HTML monitoring
          arg: rawArg,
          title,
          lastPubDate: new Date(), // HTML monitoring doesn't have real timestamps
          lastContent: [],
          followers: []
        }

        // Check for duplicate (if enabled)
        if (config.basic.urlDeduplication && rssList.find(i => i.rssId == rssItem.rssId)) {
          return `订阅已存在: ${rssItem.rssId}`
        }

        // Save to database
        await ctx.database.create(('rssOwl' as any), rssItem)

        // First load preview (if enabled)
        if (config.basic.firstLoad && arg.firstLoad !== false && htmlItems.length > 0) {
          const maxItem = arg.forceLength || 1
          // 使用合并后的配置来确保图片/视频模式生效
          const mergedArg = mixinArgLocal(rssItem.arg)
          let messageList = await Promise.all(
            htmlItems
              .filter((v, i) => i < maxItem)
              .map(async i => await parseRssItem(i, { ...rssItem, ...mergedArg }, rssItem.author))
          )
          let message = messageList.join("")
          await ctx.broadcast([`${platform}:${guildId}`], message)
        }

        return `订阅成功: ${title}\n提示: HTML监控基于内容变化检测，请确保选择器稳定`
      } catch (error: any) {
        debugLocal(error, 'html error', 'error')
        return `抓取失败: ${getFriendlyErrorMessage(error, 'HTML监控')}`
      }
    })

  // AI subscription command
  ctx.guild()
    .command('rssowl.ask <url:string> <instruction:text>', 'AI 智能订阅网页')
    .alias('rsso.ask')
    .usage(`AI 智能订阅功能，自动生成 CSS 选择器

前置要求:
  - 需要配置 AI 功能 (config.ai.enabled = true)
  - 需要配置 API Key (config.ai.apiKey)

用法:
  rsso.ask https://news.ycombinator.com "监控首页的前5条新闻标题"

示例:
  rsso.ask https://www.zhihu.com/billboard "获取热榜第一条"
  rsso.ask https://example.com "提取所有文章标题" -T
    `)
    .option('test', '-T 测试模式 (只分析不订阅)')
    .example('rsso.ask https://news.ycombinator.com "监控首页的前5条新闻标题"')
    .action(async ({ session, options }, url, instruction) => {
      if (!url) return '请输入网址'
      if (!instruction) return '请描述你的需求'

      url = ensureUrlProtocol(url)

      try {
        let html = (await $http(url, {})).data
        let selector = await generateSelectorByAILocal(url, instruction, html)

        if (options.test) {
          let testArg = {
            type: 'html' as const,
            selector,
            template: 'content' as const
          }
          let items = await getRssDataLocal(url, testArg)
          if (!items || items.length === 0) return `选择器未匹配到任何元素: ${selector}`
          return `AI 生成的选择器: ${selector}\n\n匹配到 ${items.length} 个元素:\n${items.slice(0, 2).map((i: any) => i.title).join('\n')}`
        }

        return `AI 生成的选择器: ${selector}\n请使用 rsso.html ${url} -s "${selector}" 完成订阅`
      } catch (error: any) {
        debugLocal(error, 'ask error', 'error')
        return `AI 分析失败: ${getFriendlyErrorMessage(error, 'AI生成选择器')}`
      }
    })

  // Simple watch command
  ctx.guild()
    .command('rssowl.watch <url:string> [keyword:text]', '简单网页监控')
    .alias('rsso.watch')
    .usage(`
简单网页监控，支持关键词或整页监控。
用法:
  rsso.watch https://example.com                    - 监控整页变化
  rsso.watch https://example.com "缺货"             - 监控包含关键词的内容
  rsso.watch https://example.com "缺货" -P          - SPA 动态页面
  rsso.watch https://example.com "缺货" -T          - 测试模式 (只预览不订阅)
    `)
    .option('puppeteer', '-P 使用 Puppeteer 渲染')
    .option('test', '-T 测试模式 (只预览不订阅)')
    .example('rsso.watch https://example.com "缺货"')
    .action(async ({ session, options }, url, keyword) => {
      if (!url) return '请输入 URL'

      const { id: guildId } = session.event.guild as any
      const { platform } = session.event as any
      const { id: userId } = session.event.user as any
      // 获取 bot selfId 用于后续推送
      const botSelfId = session.bot?.selfId

      url = ensureUrlProtocol(url)

      let rawArg: any = {
        type: 'html' as const,
        selector: keyword ? `*:contains("${keyword}")` : 'body',
        textOnly: !!keyword,
        mode: options.puppeteer ? 'puppeteer' : 'static',
        template: 'content' as const
      }
      let arg = mixinArgLocal(rawArg)

      try {
        if (options.test) {
          let items = await getRssDataLocal(url, arg)
          if (!items || items.length === 0) return '未找到内容'
          let preview = items.slice(0, 3).map((item: any) =>
            `标题: ${item.title}\n${item.description?.substring(0, 100)}...`
          ).join('\n\n')
          return `找到 ${items.length} 条内容:\n\n${preview}`
        }

        return '请使用 rsso 命令完成订阅，或使用 -T 测试'
      } catch (error: any) {
        debugLocal(error, 'watch error', 'error')
        return `监控失败: ${getFriendlyErrorMessage(error, '网页监控')}`
      }
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
