import axios from 'axios'
import * as cheerio from 'cheerio'
import * as crypto from 'crypto'
import { Config } from '../types'
import { debug } from '../utils/logger'
import { buildAxiosProxyConfig } from '../utils/proxy'
import { webSearch, formatSearchResults, buildPromptWithSearchContext } from './search'
import { normalizeSearchConfig } from '../config'

/**
 * AI 摘要缓存接口
 */
interface CacheEntry {
  summary: string
  timestamp: number
  lastAccess: number  // 用于 LRU
}

/**
 * AI 摘要结果接口
 */
interface SummaryResult {
  success: boolean
  summary: string
  cached: boolean
  error?: string
}

/**
 * AI 摘要缓存管理器
 */
export class AiSummaryCache {
  private cache: Map<string, CacheEntry> = new Map()
  private ttl: number // 缓存过期时间（毫秒）
  private maxSize: number // 最大缓存条数
  private accessOrder: string[] = // LRU 访问顺序追踪
    []

  constructor(ttl: number = 24 * 60 * 60 * 1000, maxSize: number = 1000) {
    this.ttl = ttl
    this.maxSize = maxSize
  }

  /**
   * 触发 LRU 淘汰，移除最久未访问的条目
   */
  private evictIfNeeded(): void {
    // 如果缓存未达到最大限制，不需要淘汰
    // 注意：这里用 > 而不是 >=，确保添加新项后不会超过限制
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift()
      if (oldestKey && this.cache.has(oldestKey)) {
        this.cache.delete(oldestKey)
      }
      // 防止死循环，如果 accessOrder 为空但 cache 仍满，随机删除一个
      if (this.accessOrder.length === 0 && this.cache.size >= this.maxSize) {
        const randomKey = this.cache.keys().next().value
        if (randomKey) {
          this.cache.delete(randomKey)
        }
        break
      }
    }
  }

  /**
   * 更新访问顺序（LRU）
   */
  private updateAccessOrder(key: string): void {
    // 从当前位置移除（如果存在）
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    // 添加到末尾（最近访问）
    this.accessOrder.push(key)
  }

  /**
   * 从访问顺序中移除指定键
   */
  private removeAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
  }

  /**
   * 生成缓存键（基于内容的哈希）
   */
  private generateKey(title: string, content: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${title}|||${content}`)
      .digest('hex')
    return hash
  }

  /**
   * 获取缓存
   */
  get(title: string, content: string): string | null {
    const key = this.generateKey(title, content)
    const entry = this.cache.get(key)

    if (!entry) return null

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      this.removeAccessOrder(key)
      return null
    }

    // 更新访问顺序（LRU）
    this.updateAccessOrder(key)
    entry.lastAccess = Date.now()

    return entry.summary
  }

  /**
   * 设置缓存
   */
  set(title: string, content: string, summary: string): void {
    const key = this.generateKey(title, content)

    // 如果已存在，更新访问顺序并更新时间戳
    if (this.cache.has(key)) {
      this.updateAccessOrder(key)
      const entry = this.cache.get(key)!
      entry.summary = summary
      entry.timestamp = Date.now()
      entry.lastAccess = Date.now()
      return
    }

    // 如果是新条目，先检查是否需要淘汰
    this.evictIfNeeded()

    this.cache.set(key, {
      summary,
      timestamp: Date.now(),
      lastAccess: Date.now()
    })

    // 添加到访问顺序
    this.accessOrder.push(key)
  }

  /**
   * 清除过期缓存
   */
  cleanExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key)
        this.removeAccessOrder(key)
      }
    }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
    this.accessOrder = []
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    }
  }
}

// 全局缓存实例
let globalCache: AiSummaryCache | null = null

/**
 * 初始化 AI 摘要缓存
 */
export function initAiCache(ttl?: number, maxSize?: number): void {
  if (!globalCache) {
    // 使用配置中的 maxSize 或默认值 1000
    const defaultMaxSize = 1000
    globalCache = new AiSummaryCache(ttl, maxSize || defaultMaxSize)
    debug({ debug: 'info' } as Config, `AI 摘要缓存已初始化 (TTL: ${ttl || 24*60*60*1000}ms, MaxSize: ${maxSize || defaultMaxSize})`, 'AI-Cache', 'info')
  }
}

/**
 * 清洗 HTML 内容为纯文本
 */
function cleanHtmlContent(contentHtml: string, maxLength: number): string {
  const $ = cheerio.load(contentHtml || '')
  // 移除脚本、样式、图片等无关标签
  $('script').remove()
  $('style').remove()
  $('img').remove()
  $('video').remove()
  let plainText = $.text().replace(/\s+/g, ' ').trim()

  // 截断超长文本
  if (plainText.length > maxLength) {
    plainText = plainText.substring(0, maxLength) + '...'
  }

  return plainText
}

/**
 * 调用 AI API 生成摘要（带智能降级）
 */
async function callAiApi(
  config: Config,
  prompt: string,
  context: string
): Promise<SummaryResult> {
  // 最大重试次数
  const maxRetries = 2

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      debug(config, `AI 请求尝试 ${attempt + 1}/${maxRetries + 1}: ${context}`, 'AI', 'info')

      const requestConfig: any = {
        headers: {
          'Authorization': `Bearer ${config.ai.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: config.ai.timeout,
        ...buildAxiosProxyConfig(config)
      }

      const response = await axios.post(
        `${config.ai.baseUrl!.replace(/\/+$/, '')}/chat/completions`,
        {
          model: config.ai.model,
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        },
        requestConfig
      )

      const summary = response.data?.choices?.[0]?.message?.content?.trim()

      if (!summary) {
        throw new Error('AI 返回空结果')
      }

      debug(config, `AI 摘要生成成功: ${summary.substring(0, 20)}...`, 'AI', 'details')
      return {
        success: true,
        summary,
        cached: false
      }
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries

      debug(
        config,
        `AI 请求失败 (尝试 ${attempt + 1}/${maxRetries + 1}): ${error.message}`,
        'AI',
        isLastAttempt ? 'error' : 'info'
      )

      // 如果是最后一次尝试，返回降级结果
      if (isLastAttempt) {
        return {
          success: false,
          summary: '',
          cached: false,
          error: error.message
        }
      }

      // 等待后重试（指数退避）
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000 // 1s, 2s
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
  }

  // 不应该到这里，但为了类型安全
  return {
    success: false,
    summary: '',
    cached: false,
    error: '未知错误'
  }
}

/**
 * 生成单条 AI 摘要（带缓存和降级）
 */
export async function getAiSummary(
  config: Config,
  title: string,
  contentHtml: string
): Promise<string> {
  // AI 功能未启用
  if (!config.ai.enabled || !config.ai.apiKey) return ''

  // 初始化缓存（如果还没初始化）
  if (!globalCache) {
    initAiCache(undefined, config.security?.maxCacheSize)
  }

  // 清洗内容
  const plainText = cleanHtmlContent(contentHtml, config.ai.maxInputLength!)

  // 内容太少不总结
  if (!plainText || plainText.length < 50) return ''

  // 检查缓存
  const cachedSummary = globalCache!.get(title, plainText)
  if (cachedSummary) {
    debug(config, `使用缓存的 AI 摘要: ${title}`, 'AI-Cache', 'details')
    return cachedSummary
  }

  // 构建 Prompt
  let prompt = config.ai.prompt!
    .replace('{{title}}', title || '')
    .replace('{{content}}', plainText)

  // 如果启用了联网搜索，进行搜索并增强 Prompt
  if (config.search?.enabled) {
    try {
      // 将扁平化的配置转换为嵌套的 SearchConfig
      const normalizedSearchConfig = normalizeSearchConfig(config.search)

      // 生成搜索查询（使用标题作为查询）
      const searchQuery = title || plainText.substring(0, 100)

      debug(config, `正在联网搜索: ${searchQuery}`, 'AI-Search', 'info')

      // 执行搜索
      const searchResults = await webSearch(config, searchQuery, normalizedSearchConfig)

      // 如果搜索成功，将搜索结果添加到 Prompt 中
      if (searchResults.success && searchResults.results.length > 0) {
        debug(config, `联网搜索成功，找到 ${searchResults.results.length} 条结果`, 'AI-Search', 'details')
        prompt = buildPromptWithSearchContext(prompt, searchResults, searchQuery)
      } else if (searchResults.error) {
        debug(config, `联网搜索失败: ${searchResults.error}`, 'AI-Search', 'info')
      }
    } catch (error: any) {
      debug(config, `联网搜索异常: ${error.message}`, 'AI-Search', 'error')
      // 搜索失败时不影响摘要生成，继续使用原始 Prompt
    }
  }

  // 调用 AI API
  const result = await callAiApi(config, prompt, `单条摘要: ${title}`)

  // 缓存成功的结果
  if (result.success && result.summary) {
    globalCache!.set(title, plainText, result.summary)
  }

  return result.summary
}

/**
 * 批量生成 AI 摘要（多条更新合并为一条）
 */
export async function getBatchAiSummary(
  config: Config,
  items: Array<{ title: string; content: string }>
): Promise<string> {
  // AI 功能未启用或项目数量为0
  if (!config.ai.enabled || !config.ai.apiKey || items.length === 0) return ''

  // 只有一条时使用单条摘要
  if (items.length === 1) {
    return getAiSummary(config, items[0].title, items[0].content)
  }

  debug(config, `批量生成 AI 摘要: ${items.length} 条内容`, 'AI-Batch', 'info')

  try {
    // 清洗所有内容
    const cleanedItems = items
      .map(item => ({
        title: item.title,
        content: cleanHtmlContent(item.content, config.ai.maxInputLength! / items.length)
      }))
      .filter(item => item.content.length >= 50) // 过滤太短的内容

    if (cleanedItems.length === 0) {
      debug(config, '所有内容都太短，无法生成批量摘要', 'AI-Batch', 'info')
      return ''
    }

    // 构建批量 Prompt
    let prompt = `请简要总结以下 ${cleanedItems.length} 条新闻/文章的核心内容，要求：
1. 语言简洁流畅，每条总结不超过30字
2. 按顺序总结，使用数字编号
3. 突出重点信息

${cleanedItems.map((item, index) => `
${index + 1}. 标题：${item.title}
   内容：${item.content}
`).join('\n')}

总结：`

    // 如果启用了联网搜索，对第一个或最重要的标题进行搜索
    if (config.search?.enabled && cleanedItems.length > 0) {
      try {
        // 将扁平化的配置转换为嵌套的 SearchConfig
        const normalizedSearchConfig = normalizeSearchConfig(config.search)

        // 使用第一条内容的标题作为搜索查询
        const searchQuery = cleanedItems[0].title

        debug(config, `批量摘要 - 正在联网搜索: ${searchQuery}`, 'AI-Search', 'info')

        // 执行搜索
        const searchResults = await webSearch(config, searchQuery, normalizedSearchConfig)

        // 如果搜索成功，将搜索结果添加到 Prompt 中
        if (searchResults.success && searchResults.results.length > 0) {
          debug(config, `批量摘要 - 联网搜索成功，找到 ${searchResults.results.length} 条结果`, 'AI-Search', 'details')
          prompt = buildPromptWithSearchContext(prompt, searchResults, searchQuery)
        } else if (searchResults.error) {
          debug(config, `批量摘要 - 联网搜索失败: ${searchResults.error}`, 'AI-Search', 'info')
        }
      } catch (error: any) {
        debug(config, `批量摘要 - 联网搜索异常: ${error.message}`, 'AI-Search', 'error')
        // 搜索失败时不影响摘要生成，继续使用原始 Prompt
      }
    }

    // 调用 AI API
    const result = await callAiApi(config, prompt, `批量摘要: ${cleanedItems.length}条`)

    if (result.success && result.summary) {
      debug(config, `批量摘要生成成功: ${result.summary.substring(0, 50)}...`, 'AI-Batch', 'details')
    }

    return result.summary
  } catch (error: any) {
    debug(config, `批量摘要生成失败: ${error.message}`, 'AI-Batch', 'error')
    return ''
  }
}

/**
 * 智能摘要：根据内容数量自动选择单条或批量摘要
 */
export async function getSmartAiSummary(
  config: Config,
  items: Array<{ title: string; content: string }>
): Promise<string> {
  if (!config.ai.enabled || !config.ai.apiKey || items.length === 0) {
    return ''
  }

  // 根据配置决定是否使用批量摘要
  const threshold = 3 // 超过3条时使用批量摘要

  if (items.length > threshold) {
    return getBatchAiSummary(config, items)
  } else {
    // 少量内容时，生成单条摘要后合并
    const summaries = await Promise.all(
      items.map(item => getAiSummary(config, item.title, item.content))
    )
    return summaries.filter(s => s).join('\n\n')
  }
}

/**
 * 清除过期缓存
 */
export function cleanExpiredCache(): void {
  if (globalCache) {
    globalCache.cleanExpired()
  }
}

/**
 * 清空所有缓存
 */
export function clearAiCache(): void {
  if (globalCache) {
    globalCache.clear()
  }
}

/**
 * 获取缓存统计信息
 */
export function getAiCacheStats(): { size: number; keys: string[] } | null {
  if (globalCache) {
    return globalCache.getStats()
  }
  return null
}

// ============ 导出原有的 AI 选择器生成功能 ============

/**
 * AI 智能生成 CSS 选择器（保持原有功能）
 */
export async function generateSelectorByAI(
  config: Config,
  url: string,
  instruction: string,
  html: string
): Promise<string> {
  if (!config.ai.enabled || !config.ai.apiKey) {
    throw new Error('需在配置中开启 AI 功能并填写 API Key')
  }

  // 预处理 HTML
  const $ = cheerio.load(html)
  $('script, style, svg, path, link, meta, noscript').remove()
  $('*').contents().each((_, e) => {
    if (e.type === 'comment') $(e).remove()
  })

  // 限制长度节省 token
  let cleanHtml = $('body').html()?.replace(/\s+/g, ' ').trim().substring(0, 15000) || ''

  const prompt = `
    作为一名爬虫专家，请根据提供的 HTML 代码片段，为一个网页监控工具生成一个 CSS Selector。

    目标网页：${url}
    用户需求：${instruction}

    要求：
    1. 只返回 CSS Selector 字符串，不要包含任何解释、Markdown 标记或代码块符号。
    2. Selector 必须尽可能精确，通常用于提取列表中的一项或多项。
    3. 如果是列表，请确保 Selector 能选中列表项的容器。

    HTML片段：
    ${cleanHtml}
    `

  try {
    debug(config, `正在请求 AI 生成选择器: ${instruction}`, 'AI-Selector', 'info')

    const requestConfig: any = {
      headers: {
        'Authorization': `Bearer ${config.ai.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000,
      ...buildAxiosProxyConfig(config)
    }

    const response = await axios.post(
      `${config.ai.baseUrl!.replace(/\/+$/, '')}/chat/completions`,
      {
        model: config.ai.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      },
      requestConfig
    )

    let selector = response.data?.choices?.[0]?.message?.content?.trim()
    selector = selector?.replace(/`/g, '')?.replace(/^css/i, '')?.trim()

    debug(config, `AI 生成的选择器: ${selector}`, 'AI-Selector', 'info')
    return selector || ''
  } catch (error: any) {
    debug(config, `AI 生成选择器失败: ${error.message}`, 'AI-Selector', 'error')
    throw error
  }
}
