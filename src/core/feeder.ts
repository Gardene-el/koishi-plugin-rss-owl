import { Context, clone } from 'koishi'
import { Config, rssArg } from '../types'
import { normalizeError } from '../utils/error-handler'
import { trackError } from '../utils/error-tracker'
import { createDebugWithContext, debug } from '../utils/logger'
import { parsePubDate, parseQuickUrl } from '../utils/common'
import { getRssData } from './parser'
import { RssItemProcessor } from './item-processor'
import { quickList } from '../constants'
import { NotificationQueueManager, QueueTaskContent } from './notification-queue'

export interface FeederDependencies {
  ctx: Context
  config: Config
  $http: any
  queueManager: NotificationQueueManager
}

let interval: any = null
let queueInterval: any = null

function buildFeedLogContext(rssItem: any): Record<string, any> {
  return {
    subscribeId: String(rssItem.id),
    rssId: rssItem.rssId || rssItem.title,
    rssTitle: rssItem.title,
    url: rssItem.url,
    guildId: rssItem.guildId,
    platform: rssItem.platform,
  }
}

function createFeedDebug(config: Config, rssItem: any) {
  return createDebugWithContext(config, buildFeedLogContext(rssItem))
}

export function findRssItem(rssList: any[], keyword: number | string) {
  // 优先匹配列表索引（用户看到的序号 1, 2, 3...）
  if (typeof keyword === 'number' || /^\d+$/.test(String(keyword))) {
    const listIndex = parseInt(String(keyword)) - 1  // 转换为数组索引（0-based）
    if (listIndex >= 0 && listIndex < rssList.length) {
      return rssList[listIndex]
    }
  }

  // 其他匹配方式：按 rssId、url、title 等
  const index = ((rssList.findIndex(i => i.rssId === +keyword) + 1) ||
    (rssList.findIndex(i => i.url == keyword) + 1) ||
    (rssList.findIndex(i => i.url.indexOf(keyword) + 1) + 1) ||
    (rssList.findIndex(i => i.title.indexOf(keyword) + 1) + 1)) - 1

  // 边界检查：确保索引有效
  if (index < 0 || index >= rssList.length) {
    return undefined
  }
  return rssList[index]
}

export function getLastContent(item: any, config: Config) {
  let arr = ['title', 'description', 'link', 'guid']
  let obj = Object.assign({}, ...arr.map(i => clone(item?.[i]) ? { [i]: item[i] } : {}))
  return { ...obj, description: String(obj?.description).replaceAll(/\s/g, '') }
}

const ARG_ENTRY_KEYS = [
  'forceLength',
  'reverse',
  'timeout',
  'interval',
  'merge',
  'maxRssItem',
  'firstLoad',
  'bodyWidth',
  'bodyPadding',
  'bodyFontSize',
  'split',
  'filter',
  'block',
  'proxyAgent',
] as const

type ArgEntryKey = typeof ARG_ENTRY_KEYS[number]

const BOOLEAN_ARG_KEYS = new Set<ArgEntryKey>(['firstLoad', 'reverse', 'merge'])
const NUMBER_ARG_KEYS = new Set<ArgEntryKey>([
  'forceLength',
  'timeout',
  'interval',
  'maxRssItem',
  'bodyWidth',
  'bodyPadding',
  'bodyFontSize',
  'split',
])
const ARRAY_ARG_KEYS = new Set<ArgEntryKey>(['filter', 'block'])
const FALSE_CONTENT = new Set(['false', 'null', 'none', ''])

function parseArrayArg(value: string): string[] {
  return value
    .split('/')
    .map(item => item.trim())
    .filter(Boolean)
}

function extractKnownArgEntries(arg?: string): Partial<Record<ArgEntryKey, string>> {
  if (!arg) return {}

  const pattern = new RegExp(`(^|,)\\s*(${ARG_ENTRY_KEYS.join('|')})\\s*:`, 'g')
  const matches = [...arg.matchAll(pattern)]
  const result: Partial<Record<ArgEntryKey, string>> = {}

  for (let index = 0; index < matches.length; index++) {
    const currentMatch = matches[index]
    const nextMatch = matches[index + 1]
    const key = currentMatch[2] as ArgEntryKey
    const valueStart = (currentMatch.index ?? 0) + currentMatch[0].length
    const valueEnd = nextMatch?.index ?? arg.length
    result[key] = arg.slice(valueStart, valueEnd).replace(/,\s*$/, '').trim()
  }

  return result
}

function parseBooleanArg(value: unknown): boolean {
  return !FALSE_CONTENT.has(String(value ?? '').trim().toLowerCase())
}

function parseNumberArg(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeScalarArgValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  return value.split(',')[0].trim()
}

function parseProxyAgentArg(value: unknown, auth?: string): rssArg['proxyAgent'] | undefined {
  if (typeof value === 'object' && value !== null) {
    return value as rssArg['proxyAgent']
  }

  const normalizedValue = String(normalizeScalarArgValue(value) ?? '').trim()
  if (FALSE_CONTENT.has(normalizedValue.toLowerCase())) {
    return { enabled: false }
  }

  const proxyUrl = normalizedValue.includes('://') ? normalizedValue : `http://${normalizedValue}`

  try {
    const parsedUrl = new URL(proxyUrl)
    const protocol = parsedUrl.protocol.replace(':', '') || 'http'
    const host = parsedUrl.hostname
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 7890

    if (!host) return undefined

    const proxyAgent: rssArg['proxyAgent'] = {
      enabled: true,
      protocol,
      host,
      port,
    }

    if (auth) {
      const [username = '', password = ''] = auth.split('/')
      if (username) {
        proxyAgent.auth = { enabled: true, username, password }
      }
    }

    return proxyAgent
  } catch {
    return undefined
  }
}

export function formatArg(options: any, config: Config): rssArg {
  const { arg, template, auth } = options || {}
  const rawEntries: Record<string, unknown> = typeof arg === 'string'
    ? extractKnownArgEntries(arg)
    : (arg || {})
  const json: Partial<rssArg> = {}

  for (const [rawKey, rawValue] of Object.entries(rawEntries)) {
    const key = rawKey as ArgEntryKey

    if (!ARG_ENTRY_KEYS.includes(key)) continue

    if (key === 'proxyAgent') {
      const proxyAgent = parseProxyAgentArg(rawValue, auth)
      if (proxyAgent) {
        json.proxyAgent = proxyAgent
      }
      continue
    }

    if (ARRAY_ARG_KEYS.has(key)) {
      if (Array.isArray(rawValue)) {
        json[key] = rawValue.filter(Boolean) as never
      } else {
        const parsedArray = parseArrayArg(String(rawValue ?? ''))
        if (parsedArray.length) {
          json[key] = parsedArray as never
        }
      }
      continue
    }

    if (BOOLEAN_ARG_KEYS.has(key)) {
      json[key] = parseBooleanArg(normalizeScalarArgValue(rawValue)) as never
      continue
    }

    if (NUMBER_ARG_KEYS.has(key)) {
      const parsedNumber = parseNumberArg(normalizeScalarArgValue(rawValue))
      if (parsedNumber !== undefined) {
        json[key] = parsedNumber as never
      }
      continue
    }

    if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
      json[key] = String(rawValue).trim() as never
    }
  }

  if (template && config.template) {
    json.template = template
  }

  // Date/Number conversions
  if (typeof json.interval === 'number') json.interval *= 1000

  return json as rssArg
}

const mergeProxyAgent = (argProxy: any, configProxy: any, config: Config) => {
  // 打印调试信息
  debug(config, `合并代理配置 - argProxy: ${JSON.stringify(argProxy)}, configProxy.enabled: ${configProxy?.enabled}`, 'proxy merge debug', 'details')

  // 1. Explicit disable in Args (必须是明确设置为 false)
  if (argProxy?.enabled === false) {
    debug(config, `订阅明确禁用代理`, 'proxy merge', 'details')
    return { enabled: false }
  }

  // 2. Arg 有完整的 proxy 配置 (enabled=true 且有 host) -> 使用 Arg
  if (argProxy?.enabled === true && argProxy?.host) {
    debug(config, `使用订阅的代理配置`, 'proxy merge', 'details')
    return argProxy
  }

  // 3. Arg 是空对象、undefined、null，或者没有 enabled 字段 -> 使用全局配置
  // 这是关键：如果订阅没有单独配置代理，就应该使用全局配置
  const shouldUseConfigProxy = !argProxy || Object.keys(argProxy || {}).length === 0 || argProxy?.enabled === undefined || argProxy?.enabled === null

  if (shouldUseConfigProxy) {
    if (configProxy?.enabled) {
      const result = {
        enabled: true,
        protocol: configProxy.protocol,
        host: configProxy.host,
        port: configProxy.port,
        auth: configProxy.auth?.enabled ? configProxy.auth : undefined
      }
      debug(config, `使用全局代理: ${result.protocol}://${result.host}:${result.port}`, 'proxy merge', 'info')
      return result
    } else {
      debug(config, `全局代理未启用`, 'proxy merge', 'details')
    }
  }

  // 4. Arg 的 enabled=true 但没有 host -> 尝试补充全局配置
  if (argProxy?.enabled === true && !argProxy?.host) {
    const result = {
      ...configProxy,
      ...argProxy,
      auth: configProxy?.auth?.enabled ? configProxy.auth : undefined
    }
    debug(config, `订阅代理配置不完整，补充全局配置`, 'proxy merge', 'details')
    return result
  }

  // 5. Default disabled
  debug(config, `代理未配置，使用默认(禁用)`, 'proxy merge', 'details')
  return { enabled: false }
}

const mergeProxyAgentWithLog = (argProxy: any, configProxy: any, config: Config) => {
  const result = mergeProxyAgent(argProxy, configProxy, config);
  debug(config, `[DEBUG_PROXY] mergeProxyAgent input: arg=${JSON.stringify(argProxy)} conf=${JSON.stringify(configProxy)} output=${JSON.stringify(result)}`, 'proxy merge', 'details');
  return result;
}

export function mixinArg(arg: any, config: Config): rssArg {
  const mergedProxy = mergeProxyAgentWithLog(arg?.proxyAgent, config.net?.proxyAgent, config)

  // 打印代理配置合并结果（方便调试）
  if (mergedProxy?.enabled) {
    debug(config, `使用代理: ${mergedProxy.protocol}://${mergedProxy.host}:${mergedProxy.port}`, 'proxy merge', 'details')
  } else {
    debug(config, `代理未启用`, 'proxy merge', 'details')
  }

  // Flatten config into base object, prioritizing Config values
  // We explicitly take known safe config sections
  const baseConfig = {
    ...config.basic,
    // Add other flat config sections if necessary
  }

  const res = {
    ...baseConfig,
    ...arg, // Args override basic config
    filter: [...(config.msg?.keywordFilter || []), ...(arg?.filter || [])],
    block: [...(config.msg?.keywordBlock || []), ...(arg?.block || [])],
    template: arg.template ?? config.basic?.defaultTemplate,
    proxyAgent: mergedProxy
  }
  debug(config, `[DEBUG_PROXY] mixinArg return: ${JSON.stringify(res.proxyAgent)}`, 'mixin', 'details');
  return res;
}

// ============ 拆分出的辅助函数 ============

/**
 * 1. 抓取 RSS 数据
 */
async function fetchRssItems(
  ctx: Context,
  config: Config,
  $http: any,
  rssItem: any,
  arg: rssArg,
  feedDebug: ReturnType<typeof createDebugWithContext>
): Promise<any[]> {
  const rssHubUrl = config.msg?.rssHubUrl || 'https://hub.slarker.me'

  try {
    const urls = rssItem.url.split("|").map((u: string) => parseQuickUrl(u, rssHubUrl, quickList))
    const fetchPromises = urls.map((url: string) => getRssData(ctx, config, $http, url, arg))
    const results = await Promise.all(fetchPromises)
    return results.flat(1)
  } catch (err: any) {
    const normalizedError = normalizeError(err)
    feedDebug(`Fetch failed for ${rssItem.title}: ${normalizedError.message}`, 'feeder', 'error', {
      stage: 'fetch',
    })
    trackError(normalizedError, {
      ...buildFeedLogContext(rssItem),
      stage: 'fetch',
    })
    return []
  }
}

/**
 * 2. 过滤关键字
 */
function filterItems(config: Config, items: any[], arg: rssArg, feedDebug: ReturnType<typeof createDebugWithContext>): any[] {
  return items.filter(item => {
    const matchKeyword = arg.filter?.find((keyword: string) =>
      new RegExp(keyword, 'im').test(item.title) || new RegExp(keyword, 'im').test(item.description)
    )
    if (matchKeyword) {
      feedDebug(`filter:${matchKeyword}`, 'feeder', 'info', { matchedKeyword: matchKeyword })
      feedDebug(item, 'filter rss item', 'info', { matchedKeyword: matchKeyword })
    }
    return !matchKeyword
  })
}

/**
 * 3. 检查更新（时间+内容）
 */
function checkForUpdates(
  config: Config,
  rssItem: any,
  items: any[],
  arg: rssArg,
  feedDebug: ReturnType<typeof createDebugWithContext>
): { newItems: any[]; latestPubDate: Date; currentContent: any[] } {
  // 按时间排序
  let itemArray = items
    .sort((a, b) => parsePubDate(config, b.pubDate).getTime() - parsePubDate(config, a.pubDate).getTime())

  if (itemArray.length === 0) {
    return { newItems: [], latestPubDate: new Date(), currentContent: [] }
  }

  const latestItem = itemArray[0]
  const lastPubDate = parsePubDate(config, latestItem.pubDate)

  feedDebug(`${rssItem.title}: Latest item date=${lastPubDate.toISOString()}, DB date=${rssItem.lastPubDate ? new Date(rssItem.lastPubDate).toISOString() : 'none'}`, 'feeder', 'details')

  // 准备去重内容
  const currentContent = config.basic?.resendUpdataContent === 'all'
    ? itemArray.map((i: any) => getLastContent(i, config))
    : [getLastContent(latestItem, config)]

  // 反转顺序（发送顺序：最早的先发）
  if (arg.reverse) {
    itemArray = itemArray.reverse()
  }

  let rssItemArray: any[] = []

  if (rssItem.arg.forceLength) {
    // 强制长度模式：忽略时间，只取 N 条
    rssItemArray = itemArray.slice(0, rssItem.arg.forceLength)
    feedDebug(`${rssItem.title}: Force length mode, taking ${rssItemArray.length} items`, 'feeder', 'details')
  } else {
    // 标准模式：时间 + 内容检查
    feedDebug(`${rssItem.title}: Checking ${itemArray.length} items for updates`, 'feeder', 'details')
    rssItemArray = itemArray.filter((v, i) => {
      const currentItemTime = parsePubDate(config, v.pubDate).getTime()
      const lastTime = rssItem.lastPubDate ? parsePubDate(config, rssItem.lastPubDate).getTime() : 0

      feedDebug(`[${i}] ${v.title?.substring(0, 30)}: time=${new Date(currentItemTime).toISOString()} > last=${new Date(lastTime).toISOString()} ? ${currentItemTime > lastTime}`, 'feeder', 'details')

      // 严格时间检查
      if (currentItemTime > lastTime) {
        feedDebug(`[${i}] ✓ Item is new (time check)`, 'feeder', 'details')
        return true
      }

      // 内容哈希检查（时间相同但内容变化）
      if (config.basic?.resendUpdataContent !== 'disable') {
        const newItemContent = getLastContent(v, config)
        const oldItemMatch = rssItem.lastContent?.itemArray?.find((old: any) =>
          (newItemContent.guid && old.guid === newItemContent.guid) ||
          (old.link === newItemContent.link && old.title === newItemContent.title)
        )

        if (oldItemMatch) {
          const descriptionChanged = JSON.stringify(oldItemMatch.description) !== JSON.stringify(newItemContent.description)
          if (descriptionChanged) {
            feedDebug(`[${i}] ✓ Item is updated (content changed)`, 'feeder', 'details')
          } else {
            feedDebug(`[${i}] ✗ Item filtered (already sent)`, 'feeder', 'details')
          }
          return descriptionChanged
        } else {
          feedDebug(`[${i}] ✗ Item filtered (no match in lastContent)`, 'feeder', 'details')
        }
      }
      feedDebug(`[${i}] ✗ Item filtered (failed all checks)`, 'feeder', 'details')
      return false
    })

    // 应用最大条目限制
    if (arg.maxRssItem) {
      rssItemArray = rssItemArray.slice(0, arg.maxRssItem)
    }
  }

  return { newItems: rssItemArray, latestPubDate: lastPubDate, currentContent }
}

/**
 * 4. 生成消息
 */
async function generateMessages(
  processor: RssItemProcessor,
  items: any[],
  rssItem: any,
  arg: rssArg
): Promise<{ messageList: string[]; itemsToSend: any[] }> {
  const itemsToSend = [...items].reverse()

  // 生成所有消息
  const messageList = (await Promise.all(
    itemsToSend.map(async i => await processor.parseRssItem(i, { ...rssItem, ...arg }, rssItem.author))
  )).filter(m => m)

  return { messageList, itemsToSend }
}

/**
 * 5. 构建最终消息
 */
function buildFinalMessage(
  config: Config,
  messageList: string[],
  rssItem: any,
  arg: rssArg
): string {
  let message = ""
  const shouldMerge = arg.merge === true || config.basic?.merge === '一直合并' || (config.basic?.merge === '有多条更新时合并' && messageList.length > 1)

  // 检查是否需要合并视频
  const hasVideo = config.basic?.margeVideo && messageList.some(msg => /<video/.test(msg))

  if (shouldMerge || hasVideo) {
    message = `<message forward><author id="${rssItem.author}"/>${messageList.map(m => `<message>${m}</message>`).join("")}</message>`
  } else {
    message = messageList.join("")
  }

  // 添加提及
  if (rssItem.followers && rssItem.followers.length > 0) {
    const mentions = rssItem.followers.map((id: string) => `<at ${id === 'all' ? 'type="all"' : `id="${id}"`}/>`).join(" ")
    message += `<message>${mentions}</message>`
  }

  return message
}

// ============ 主函数 ============

/**
 * 生产者：抓取 RSS，发现新消息，存入队列
 */
export async function feeder(deps: FeederDependencies, processor: RssItemProcessor) {
  const { ctx, config, $http, queueManager } = deps

  // Use type assertion for custom table
  const rssList = await ctx.database.get(('rssOwl' as any), {})
  if (!rssList || rssList.length === 0) return

  for (const rssItem of rssList) {
    try {
      const feedDebug = createFeedDebug(config, rssItem)

      // 1. Prepare Arguments
      let arg: rssArg = mixinArg(rssItem.arg || {}, config)
      feedDebug(`[DEBUG_PROXY] feeder mixinArg result proxyAgent: ${JSON.stringify(arg.proxyAgent)}`, 'feeder', 'details')
      let originalArg = clone(rssItem.arg || {})

      // 2. Interval Check
      if (rssItem.arg.interval) {
        const now = Date.now()
        if (arg.nextUpdataTime && arg.nextUpdataTime > now) continue

        // Calculate next update time
        if (arg.nextUpdataTime) {
          const missed = Math.ceil((now - arg.nextUpdataTime) / arg.interval)
          originalArg.nextUpdataTime = arg.nextUpdataTime + (arg.interval * (missed || 1))
        } else {
          originalArg.nextUpdataTime = now + arg.interval
        }
      }

      // 3. Fetch RSS Data
      const rssItemList = await fetchRssItems(ctx, config, $http, rssItem, arg, feedDebug)
      if (rssItemList.length === 0) {
        await ctx.database.set(('rssOwl' as any), { id: rssItem.id }, {
          lastPubDate: rssItem.lastPubDate,
          arg: originalArg,
          lastContent: rssItem.lastContent || { itemArray: [] }
        })
        continue
      }

      // 4. Filter Items
      const filteredItems = filterItems(config, rssItemList, arg, feedDebug)
      if (filteredItems.length === 0) {
        const latestItem = [...rssItemList]
          .sort((a, b) => parsePubDate(config, b.pubDate).getTime() - parsePubDate(config, a.pubDate).getTime())[0]

        await ctx.database.set(('rssOwl' as any), { id: rssItem.id }, {
          lastPubDate: latestItem ? parsePubDate(config, latestItem.pubDate) : rssItem.lastPubDate,
          arg: originalArg,
          lastContent: latestItem
            ? { itemArray: [getLastContent(latestItem, config)] }
            : (rssItem.lastContent || { itemArray: [] })
        })
        continue
      }

      // 5. Check for Updates
      const { newItems, latestPubDate, currentContent } = checkForUpdates(config, rssItem, filteredItems, arg, feedDebug)

      if (newItems.length === 0) {
        feedDebug(`${rssItem.title}: No new items found after filtering`, 'feeder', 'info', { newItemCount: 0 })
        await ctx.database.set(('rssOwl' as any), { id: rssItem.id }, {
          lastPubDate: latestPubDate,
          arg: originalArg,
          lastContent: { itemArray: currentContent }
        })
        continue
      }

      feedDebug(`${rssItem.title}: Found ${newItems.length} new items`, 'feeder', 'info', { newItemCount: newItems.length })
      feedDebug(newItems.map(i => i.title), 'feeder', 'info', { newItemCount: newItems.length })

      // 6. Generate Messages
      const { messageList, itemsToSend } = await generateMessages(processor, newItems, rssItem, arg)

      if (messageList.length === 0) {
        feedDebug(`${rssItem.title}: Items found but parsed to empty messages`, 'feeder', 'info', { newItemCount: newItems.length })
        await ctx.database.set(('rssOwl' as any), { id: rssItem.id }, { lastPubDate: latestPubDate, arg: originalArg, lastContent: { itemArray: currentContent } })
        continue
      }

      // 7. Build Final Message
      const message = buildFinalMessage(config, messageList, rssItem, arg)

      // 8. Add to Queue
      const taskContent: QueueTaskContent = {
        message,
        originalItem: itemsToSend[0],
        isDowngraded: false,
        title: itemsToSend[0]?.title,
        description: itemsToSend[0]?.description,
        link: itemsToSend[0]?.link,
        pubDate: parsePubDate(config, itemsToSend[0]?.pubDate),
        imageUrl: itemsToSend[0]?.enclosure?.url
      }

      await queueManager.addTask({
        subscribeId: String(rssItem.id),
        rssId: rssItem.rssId || rssItem.title,
        uid: itemsToSend[0]?.link || itemsToSend[0]?.guid || `${Date.now()}`,
        guildId: rssItem.guildId,
        platform: rssItem.platform,
        content: taskContent
      })

      feedDebug(`✓ 已添加到发送队列: ${rssItem.title}`, 'feeder', 'info', {
        queuedItemTitle: itemsToSend[0]?.title,
      })

      // 9. Update Database State
      await ctx.database.set(('rssOwl' as any), { id: rssItem.id }, {
        lastPubDate: latestPubDate,
        arg: originalArg,
        lastContent: { itemArray: currentContent }
      })

    } catch (err: any) {
      const normalizedError = normalizeError(err)
      const feedContext = buildFeedLogContext(rssItem)

      debug(config, `Feeder error for ${rssItem.url}: ${normalizedError.message}`, 'feeder', 'error', feedContext)
      trackError(normalizedError, feedContext)
    }
  }
}

export function startFeeder(ctx: Context, config: Config, $http: any, processor: RssItemProcessor, queueManager: NotificationQueueManager) {
  const deps = { ctx, config, $http, queueManager }
  const lifecycleDebug = createDebugWithContext(config, { lifecycle: 'feeder' })

  // Initial run
  feeder(deps, processor).catch(err => {
    const normalizedError = normalizeError(err)
    lifecycleDebug(`Initial feeder run failed: ${normalizedError.message}`, 'feeder', 'error', {
      operation: 'initial-feeder-run',
    })
    trackError(normalizedError, {
      lifecycle: 'feeder',
      operation: 'initial-feeder-run',
    })
  })

  // 启动生产者定时器（抓取 RSS）
  const refreshInterval = (config.basic?.refresh || 600) * 1000
  interval = setInterval(async () => {
    if (config.basic?.imageMode === 'File') {
      const { delCache } = await import('../utils/media')
      await delCache(config)
    }
    await feeder(deps, processor)
  }, refreshInterval)

  // 启动消费者定时器（处理发送队列）
  // 频率更高，确保消息快速发送
  const queueProcessInterval = 30 * 1000 // 每 30 秒处理一次队列
  queueInterval = setInterval(async () => {
    await queueManager.processQueue()
  }, queueProcessInterval)

  // 立即处理一次队列（启动时）
  queueManager.processQueue().catch(err => {
    const normalizedError = normalizeError(err)
    lifecycleDebug(`Initial queue processing failed: ${normalizedError.message}`, 'queue', 'error', {
      operation: 'initial-queue-processing',
    })
    trackError(normalizedError, {
      lifecycle: 'feeder',
      operation: 'initial-queue-processing',
    })
  })

  lifecycleDebug('Feeder started', 'feeder', 'info', {
    refreshInterval,
    queueProcessInterval,
  })
}

export function stopFeeder(config?: Config) {
  if (interval) {
    clearInterval(interval)
    interval = null
  }
  if (queueInterval) {
    clearInterval(queueInterval)
    queueInterval = null
  }

  if (config) {
    const lifecycleDebug = createDebugWithContext(config, { lifecycle: 'feeder' })
    lifecycleDebug('Feeder stopped', 'feeder', 'info')
  }
}
