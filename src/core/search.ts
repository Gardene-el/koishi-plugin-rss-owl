/**
 * 联网搜索模块
 *
 * 支持多种搜索引擎：
 * - Tavily: 专业的 AI 搜索引擎
 * - Searxng: 开源隐私友好的元搜索引擎
 * - Volcengine: 火山引擎联网搜索（支持模型轮询）
 *
 * @module core/search
 */

import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { Config, SearchConfig } from '../types'
import { debug } from '../utils/logger'

/**
 * 搜索结果接口
 */
export interface SearchResult {
  title: string
  url: string
  snippet?: string
  content?: string
  score?: number
  publishedDate?: string
  source?: string
}

/**
 * 搜索响应接口
 */
export interface SearchResponse {
  success: boolean
  results: SearchResult[]
  query: string
  engine: string
  model?: string  // 使用的模型（用于火山引擎）
  error?: string
}

/**
 * 模型轮询状态
 */
interface ModelRotationState {
  currentIndex: number
  models: string[]
  lastFailureTime: number
  failureCount: number
}

// 全局模型轮询状态
const modelRotationStates = new Map<string, ModelRotationState>()

/**
 * 获取或初始化模型轮询状态
 */
function getModelRotationState(key: string, models: string[]): ModelRotationState {
  if (!modelRotationStates.has(key)) {
    modelRotationStates.set(key, {
      currentIndex: 0,
      models,
      lastFailureTime: 0,
      failureCount: 0
    })
  }
  return modelRotationStates.get(key)!
}

/**
 * 获取下一个可用模型（轮询）
 */
function getNextModel(config: Config, searchConfig: SearchConfig): string {
  // 如果配置了模型列表，使用轮询
  if (searchConfig.volcengine?.models && searchConfig.volcengine.models.length > 0) {
    const state = getModelRotationState('volcengine', searchConfig.volcengine.models)

    // 如果上次失败时间在 1 分钟内，跳到下一个模型
    const now = Date.now()
    if (state.lastFailureTime > 0 && now - state.lastFailureTime < 60000) {
      state.currentIndex = (state.currentIndex + 1) % state.models.length
      debug(config, `模型轮询: 上次失败，切换到模型 ${state.models[state.currentIndex]}`, 'Search-Volcengine', 'info')
    }

    const model = state.models[state.currentIndex]
    state.lastFailureTime = 0  // 重置失败时间
    return model
  }

  // 否则使用 AI 配置中的模型
  if (searchConfig.volcengine?.useAiModel !== false && config.ai.model) {
    return config.ai.model
  }

  // 默认模型列表（轮询）
  const defaultModels = [
    'doubao-seed-1-6-lite-251015',
    'doubao-seed-1-6-flash-250828'
  ]

  const state = getModelRotationState('volcengine-default', defaultModels)
  const model = defaultModels[state.currentIndex]

  // 轮询到下一个模型
  state.currentIndex = (state.currentIndex + 1) % defaultModels.length

  return model
}

/**
 * 标记模型失败（触发切换到下一个模型）
 */
function markModelFailure(config: Config, searchConfig: SearchConfig, model: string): void {
  const key = searchConfig.volcengine?.models ? 'volcengine' : 'volcengine-default'
  const state = modelRotationStates.get(key)

  if (state) {
    state.lastFailureTime = Date.now()
    state.failureCount++
    state.currentIndex = (state.currentIndex + 1) % state.models.length

    debug(
      config,
      `模型 ${model} 失败，切换到下一个模型 ${state.models[state.currentIndex]} (失败次数: ${state.failureCount})`,
      'Search-Volcengine',
      'info'
    )
  }
}

/**
 * Tavily 搜索响应接口
 */
interface TavilyResponse {
  answer?: string
  query: string
  results: Array<{
    title: string
    url: string
    content: string
    score: number
    published_date?: string
  }>
}

/**
 * SearXNG 搜索响应接口
 */
interface SearxngResponse {
  query: string
  results: Array<{
    title: string
    url: string
    content: string
    snippet?: string
    engine?: string
    score?: number
  }>
}

/**
 * 火山引擎搜索工具接口
 */
interface VolcengineSearchTool {
  type: 'web_search'
  search_result?: {
    query: string
    web_contents: Array<{
      title: string
      url: string
      content: string
      published_date?: string
    }>
  }
}

/**
 * 构建代理配置
 */
function buildProxyConfig(config: Config): any {
  const requestConfig: any = {}

  if (config.net.proxyAgent?.enabled) {
    const proxyUrl = `${config.net.proxyAgent.protocol}://${config.net.proxyAgent.host}:${config.net.proxyAgent.port}`
    requestConfig.httpsAgent = new HttpsProxyAgent(proxyUrl)
    requestConfig.proxy = false
  }

  return requestConfig
}

/**
 * Tavily 搜索引擎
 *
 * @param config - 插件配置
 * @param query - 搜索查询
 * @param apiKey - Tavily API Key
 * @returns 搜索结果
 */
export async function searchWithTavily(
  config: Config,
  query: string,
  apiKey: string,
  options?: {
    maxResults?: number
    searchDepth?: 'basic' | 'advanced'
    includeAnswer?: boolean
  }
): Promise<SearchResponse> {
  try {
    debug(config, `使用 Tavily 搜索: ${query}`, 'Search-Tavily', 'info')

    const requestConfig: any = {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: config.ai.timeout || 30000,
      ...buildProxyConfig(config)
    }

    const requestBody: any = {
      query,
      max_results: options?.maxResults || 5,
      search_depth: options?.searchDepth || 'basic',
      include_answer: options?.includeAnswer !== false,
      include_raw_content: false
    }

    const response = await axios.post<TavilyResponse>(
      'https://api.tavily.com/search',
      requestBody,
      requestConfig
    )

    const results: SearchResult[] = response.data.results.map(item => ({
      title: item.title,
      url: item.url,
      content: item.content,
      snippet: item.content.substring(0, 200) + '...',
      score: item.score,
      publishedDate: item.published_date,
      source: 'tavily'
    }))

    debug(config, `Tavily 搜索成功，找到 ${results.length} 条结果`, 'Search-Tavily', 'details')

    return {
      success: true,
      results,
      query,
      engine: 'tavily'
    }
  } catch (error: any) {
    const errorMsg = `Tavily 搜索失败: ${error.message}`
    debug(config, errorMsg, 'Search-Tavily', 'error')

    return {
      success: false,
      results: [],
      query,
      engine: 'tavily',
      error: errorMsg
    }
  }
}

/**
 * SearXNG 搜索引擎
 *
 * @param config - 插件配置
 * @param query - 搜索查询
 * @param instanceUrl - SearXNG 实例 URL
 * @returns 搜索结果
 */
export async function searchWithSearxng(
  config: Config,
  query: string,
  instanceUrl: string,
  options?: {
    maxResults?: number
    language?: string
    categories?: Array<'general' | 'news' | 'images' | 'videos'>
  }
): Promise<SearchResponse> {
  try {
    debug(config, `使用 SearXNG 搜索: ${query}`, 'Search-SearXNG', 'info')

    const baseUrl = instanceUrl.replace(/\/+$/, '')
    const requestConfig: any = {
      timeout: config.ai.timeout || 30000,
      ...buildProxyConfig(config)
    }

    const params: any = {
      q: query,
      format: 'json',
      language: options?.language || 'all',
      categories: options?.categories?.join(',') || 'general'
    }

    const response = await axios.get<SearxngResponse>(
      `${baseUrl}/search`,
      {
        ...requestConfig,
        params
      }
    )

    const maxResults = options?.maxResults || 5
    const results: SearchResult[] = response.data.results
      .slice(0, maxResults)
      .map(item => ({
        title: item.title,
        url: item.url,
        content: item.content,
        snippet: item.snippet || item.content.substring(0, 200) + '...',
        score: item.score,
        source: `searxng-${item.engine || 'unknown'}`
      }))

    debug(config, `SearXNG 搜索成功，找到 ${results.length} 条结果`, 'Search-SearXNG', 'details')

    return {
      success: true,
      results,
      query,
      engine: 'searxng'
    }
  } catch (error: any) {
    const errorMsg = `SearXNG 搜索失败: ${error.message}`
    debug(config, errorMsg, 'Search-SearXNG', 'error')

    return {
      success: false,
      results: [],
      query,
      engine: 'searxng',
      error: errorMsg
    }
  }
}

/**
 * 火山引擎联网搜索（支持模型轮询）
 *
 * @param config - 插件配置
 * @param query - 搜索查询
 * @param baseUrl - API Base URL
 * @param apiKey - API Key
 * @param model - 模型名称（可选，如果不指定则使用轮询）
 * @param searchConfig - 搜索配置（用于模型轮询）
 * @returns 搜索结果
 */
export async function searchWithVolcengine(
  config: Config,
  query: string,
  baseUrl: string,
  apiKey: string,
  model?: string,
  searchConfig?: SearchConfig
): Promise<SearchResponse> {
  // 获取要使用的模型
  const actualModel = model || getNextModel(config, searchConfig || {})

  try {
    debug(config, `使用火山引擎搜索: ${query} (模型: ${actualModel})`, 'Search-Volcengine', 'info')

    const requestConfig: any = {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: config.ai.timeout || 30000,
      ...buildProxyConfig(config)
    }

    // 使用 Responses API 调用联网搜索工具
    const response = await axios.post(
      `${baseUrl.replace(/\/+$/, '')}/responses`,
      {
        model: actualModel,  // 使用轮询获取的模型
        input: [
          {
            role: 'user',
            content: query
          }
        ],
        tools: [
          {
            type: 'web_search'
          }
        ]
      },
      requestConfig
    )

    // 从响应中提取搜索结果
    let searchResults: SearchResult[] = []

    // 火山引擎的搜索结果嵌入在 AI 响应的 annotations 中
    if (response.data?.output && Array.isArray(response.data.output)) {
      for (const outputItem of response.data.output) {
        if (outputItem.type === 'message' &&
            outputItem.role === 'assistant' &&
            outputItem.content &&
            Array.isArray(outputItem.content)) {

          for (const contentItem of outputItem.content) {
            if (contentItem.type === 'output_text' &&
                contentItem.annotations &&
                Array.isArray(contentItem.annotations)) {

              // 从 annotations 中提取 url_citation 类型的引用
              for (const annotation of contentItem.annotations) {
                if (annotation.type === 'url_citation') {
                  searchResults.push({
                    title: annotation.title || '',
                    url: annotation.url || '',
                    content: annotation.summary || '',
                    snippet: (annotation.summary || '')?.substring(0, 200) + '...',
                    source: annotation.site_name || 'volcengine',
                    publishedDate: annotation.publish_time || undefined
                  })
                }
              }
            }
          }
        }
      }
    }

    debug(config, `火山引擎搜索成功，找到 ${searchResults.length} 条结果 (模型: ${actualModel})`, 'Search-Volcengine', 'details')

    return {
      success: true,
      results: searchResults,
      query,
      engine: 'volcengine',
      model: actualModel  // 返回使用的模型
    }
  } catch (error: any) {
    const errorMsg = `火山引擎搜索失败: ${error.message}`
    debug(config, errorMsg, 'Search-Volcengine', 'error')

    // 标记模型失败，触发轮询切换
    if (searchConfig) {
      markModelFailure(config, searchConfig, actualModel)
    }

    return {
      success: false,
      results: [],
      query,
      engine: 'volcengine',
      model: actualModel,
      error: errorMsg
    }
  }
}

/**
 * 统一搜索接口
 *
 * 根据配置自动选择搜索引擎并执行搜索
 * - 如果 engine 为 'auto'，则根据配置的 API Keys 按优先级自动选择
 * - 支持多引擎配置时智能选择
 *
 * @param config - 插件配置
 * @param query - 搜索查询
 * @param searchConfig - 搜索配置
 * @returns 搜索结果
 */
export async function webSearch(
  config: Config,
  query: string,
  searchConfig: SearchConfig
): Promise<SearchResponse> {
  // 检查是否启用搜索
  if (!searchConfig.enabled) {
    return {
      success: false,
      results: [],
      query,
      engine: 'none',
      error: '联网搜索未启用'
    }
  }

  // 如果 engine 为 auto，则自动选择可用的引擎
  if (searchConfig.engine === 'auto') {
    return autoSelectEngineAndSearch(config, query, searchConfig)
  }

  // 根据选择的搜索引擎执行搜索
  switch (searchConfig.engine) {
    case 'tavily':
      if (!searchConfig.tavily?.apiKey) {
        return {
          success: false,
          results: [],
          query,
          engine: 'tavily',
          error: 'Tavily API Key 未配置'
        }
      }
      return searchWithTavily(config, query, searchConfig.tavily.apiKey, {
        maxResults: searchConfig.maxResults || 5,
        searchDepth: searchConfig.tavily.searchDepth || 'basic',
        includeAnswer: searchConfig.tavily.includeAnswer !== false
      })

    case 'searxng':
      if (!searchConfig.searxng?.instanceUrl) {
        return {
          success: false,
          results: [],
          query,
          engine: 'searxng',
          error: 'SearXNG 实例 URL 未配置'
        }
      }
      return searchWithSearxng(config, query, searchConfig.searxng.instanceUrl, {
        maxResults: searchConfig.maxResults || 5,
        language: searchConfig.searxng.language || 'all',
        categories: searchConfig.searxng.categories || ['general']
      })

    case 'volcengine':
      if (!searchConfig.volcengine?.apiKey) {
        return {
          success: false,
          results: [],
          query,
          engine: 'volcengine',
          error: '火山引擎 API Key 未配置'
        }
      }
      return searchWithVolcengine(
        config,
        query,
        config.ai.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
        searchConfig.volcengine.apiKey,
        undefined,  // 不指定模型，使用轮询
        searchConfig  // 传递 searchConfig 用于模型轮询
      )

    default:
      return {
        success: false,
        results: [],
        query,
        engine: 'unknown',
        error: `未知的搜索引擎: ${searchConfig.engine}`
      }
  }
}

/**
 * 自动选择搜索引擎并执行搜索
 *
 * @param config - 插件配置
 * @param query - 搜索查询
 * @param searchConfig - 搜索配置
 * @returns 搜索结果
 */
async function autoSelectEngineAndSearch(
  config: Config,
  query: string,
  searchConfig: SearchConfig
): Promise<SearchResponse> {
  // 确定可用引擎的优先级
  let enginePriority = searchConfig.enginePriority || ['tavily', 'volcengine', 'searxng']

  // 根据配置过滤出可用的引擎
  const availableEngines = enginePriority.filter(engine => {
    switch (engine) {
      case 'tavily':
        return !!searchConfig.tavily?.apiKey
      case 'searxng':
        return !!searchConfig.searxng?.instanceUrl
      case 'volcengine':
        return !!searchConfig.volcengine?.apiKey
      default:
        return false
    }
  })

  if (availableEngines.length === 0) {
    return {
      success: false,
      results: [],
      query,
      engine: 'auto',
      error: '没有配置任何可用的搜索引擎'
    }
  }

  debug(config, `自动选择搜索引擎，可用引擎: ${availableEngines.join(', ')}`, 'Search-Auto', 'info')

  // 按优先级尝试每个引擎
  for (const engine of availableEngines) {
    debug(config, `尝试使用搜索引擎: ${engine}`, 'Search-Auto', 'info')

    let result: SearchResponse

    switch (engine) {
      case 'tavily':
        result = await searchWithTavily(config, query, searchConfig.tavily!.apiKey!, {
          maxResults: searchConfig.maxResults || 5,
          searchDepth: searchConfig.tavily?.searchDepth || 'basic',
          includeAnswer: searchConfig.tavily?.includeAnswer !== false
        })
        break

      case 'searxng':
        result = await searchWithSearxng(config, query, searchConfig.searxng!.instanceUrl!, {
          maxResults: searchConfig.maxResults || 5,
          language: searchConfig.searxng?.language || 'all',
          categories: searchConfig.searxng?.categories || ['general']
        })
        break

      case 'volcengine':
        result = await searchWithVolcengine(
          config,
          query,
          config.ai.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
          searchConfig.volcengine!.apiKey!,
          undefined,
          searchConfig
        )
        break

      default:
        continue
    }

    // 如果成功，返回结果
    if (result.success && result.results.length > 0) {
      debug(config, `搜索引擎 ${engine} 成功返回 ${result.results.length} 条结果`, 'Search-Auto', 'info')
      return result
    }

    // 如果失败，记录日志并尝试下一个引擎
    debug(config, `搜索引擎 ${engine} 失败: ${result.error || '无结果'}，尝试下一个引擎`, 'Search-Auto', 'info')
  }

  // 所有引擎都失败了
  return {
    success: false,
    results: [],
    query,
    engine: 'auto',
    error: '所有搜索引擎都失败了'
  }
}

/**
 * 将搜索结果格式化为 AI 可读的文本
 *
 * @param response - 搜索响应
 * @returns 格式化的文本
 */
export function formatSearchResults(response: SearchResponse): string {
  if (!response.success || response.results.length === 0) {
    return ''
  }

  const lines: string[] = []
  lines.push(`\n联网搜索结果 (${response.engine}):\n`)

  response.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`)
    lines.push(`   链接: ${result.url}`)
    if (result.snippet) {
      lines.push(`   摘要: ${result.snippet}`)
    }
    if (result.publishedDate) {
      lines.push(`   发布时间: ${result.publishedDate}`)
    }
    lines.push('')
  })

  return lines.join('\n')
}

/**
 * 构建带搜索上下文的 AI Prompt
 *
 * @param originalPrompt - 原始提示词
 * @param searchResults - 搜索结果
 * @param searchQuery - 搜索查询
 * @returns 增强后的提示词
 */
export function buildPromptWithSearchContext(
  originalPrompt: string,
  searchResults: SearchResponse,
  searchQuery: string
): string {
  if (!searchResults.success || searchResults.results.length === 0) {
    return originalPrompt
  }

  const formattedResults = formatSearchResults(searchResults)

  return `${originalPrompt}

${formattedResults}

【搜索结果使用原则】：
1. 若 RSS 原始内容残缺，请使用以上搜索结果进行补全。
2. 搜索结果仅作为背景参考，若搜索结果中的人物、时间、事件与 RSS 原文冲突，**必须以 RSS 原文为准**！请提取并生成一份事实准确、语言简洁流畅的摘要。`
}
