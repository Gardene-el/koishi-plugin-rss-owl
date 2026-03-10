import { Config, SearchConfig } from '../types'
import { debug } from '../utils/logger'
import {
  searchWithSearxng,
  searchWithTavily,
  searchWithVolcengine
} from './search-providers'
import { SearchResponse } from './search-types'

function createErrorResponse(query: string, engine: string, error: string): SearchResponse {
  return {
    success: false,
    results: [],
    query,
    engine,
    error
  }
}

function getAvailableAutoEngines(searchConfig: SearchConfig): Array<'tavily' | 'searxng' | 'volcengine'> {
  const enginePriority = searchConfig.enginePriority || ['tavily', 'volcengine', 'searxng']

  return enginePriority.filter(engine => {
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
}

export async function webSearch(
  config: Config,
  query: string,
  searchConfig: SearchConfig
): Promise<SearchResponse> {
  if (!searchConfig.enabled) {
    return createErrorResponse(query, 'none', '联网搜索未启用')
  }

  if (searchConfig.engine === 'auto') {
    return autoSelectEngineAndSearch(config, query, searchConfig)
  }

  switch (searchConfig.engine) {
    case 'tavily':
      if (!searchConfig.tavily?.apiKey) {
        return createErrorResponse(query, 'tavily', 'Tavily API Key 未配置')
      }
      return searchWithTavily(config, query, searchConfig.tavily.apiKey, {
        maxResults: searchConfig.maxResults || 5,
        searchDepth: searchConfig.tavily.searchDepth || 'basic',
        includeAnswer: searchConfig.tavily.includeAnswer !== false
      })

    case 'searxng':
      if (!searchConfig.searxng?.instanceUrl) {
        return createErrorResponse(query, 'searxng', 'SearXNG 实例 URL 未配置')
      }
      return searchWithSearxng(config, query, searchConfig.searxng.instanceUrl, {
        maxResults: searchConfig.maxResults || 5,
        language: searchConfig.searxng.language || 'all',
        categories: searchConfig.searxng.categories || ['general']
      })

    case 'volcengine':
      if (!searchConfig.volcengine?.apiKey) {
        return createErrorResponse(query, 'volcengine', '火山引擎 API Key 未配置')
      }
      return searchWithVolcengine(
        config,
        query,
        config.ai?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
        searchConfig.volcengine.apiKey,
        undefined,
        searchConfig
      )

    default:
      return createErrorResponse(query, 'unknown', `未知的搜索引擎: ${searchConfig.engine}`)
  }
}

async function autoSelectEngineAndSearch(
  config: Config,
  query: string,
  searchConfig: SearchConfig
): Promise<SearchResponse> {
  const availableEngines = getAvailableAutoEngines(searchConfig)
  if (availableEngines.length === 0) {
    return createErrorResponse(query, 'auto', '没有配置任何可用的搜索引擎')
  }

  debug(config, `自动选择搜索引擎，可用引擎: ${availableEngines.join(', ')}`, 'Search-Auto', 'info')

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
          config.ai?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
          searchConfig.volcengine!.apiKey!,
          undefined,
          searchConfig
        )
        break
    }

    if (result.success && result.results.length > 0) {
      debug(config, `搜索引擎 ${engine} 成功返回 ${result.results.length} 条结果`, 'Search-Auto', 'info')
      return result
    }

    debug(
      config,
      `搜索引擎 ${engine} 失败: ${result.error || '无结果'}，尝试下一个引擎`,
      'Search-Auto',
      'info'
    )
  }

  return createErrorResponse(query, 'auto', '所有搜索引擎都失败了')
}