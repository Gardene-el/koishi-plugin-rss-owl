import axios from 'axios'

import { Config, SearchConfig } from '../types'
import { debug } from '../utils/logger'
import { buildAxiosProxyConfig } from '../utils/proxy'
import { getNextVolcengineModel, markVolcengineModelFailure } from './search-rotation'
import { SearchResponse, SearchResult, SearxngResponse, TavilyResponse } from './search-types'

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
      timeout: config.ai?.timeout || 30000,
      ...buildAxiosProxyConfig(config)
    }

    const response = await axios.post<TavilyResponse>(
      'https://api.tavily.com/search',
      {
        query,
        max_results: options?.maxResults || 5,
        search_depth: options?.searchDepth || 'basic',
        include_answer: options?.includeAnswer !== false,
        include_raw_content: false
      },
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
      timeout: config.ai?.timeout || 30000,
      ...buildAxiosProxyConfig(config)
    }

    const response = await axios.get<SearxngResponse>(`${baseUrl}/search`, {
      ...requestConfig,
      params: {
        q: query,
        format: 'json',
        language: options?.language || 'all',
        categories: options?.categories?.join(',') || 'general'
      }
    })

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

export async function searchWithVolcengine(
  config: Config,
  query: string,
  baseUrl: string,
  apiKey: string,
  model?: string,
  searchConfig: SearchConfig = {}
): Promise<SearchResponse> {
  const actualModel = model || getNextVolcengineModel(config, searchConfig)

  try {
    debug(config, `使用火山引擎搜索: ${query} (模型: ${actualModel})`, 'Search-Volcengine', 'info')

    const requestConfig: any = {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: config.ai?.timeout || 30000,
      ...buildAxiosProxyConfig(config)
    }

    const response = await axios.post(
      `${baseUrl.replace(/\/+$/, '')}/responses`,
      {
        model: actualModel,
        input: [{ role: 'user', content: query }],
        tools: [{ type: 'web_search' }]
      },
      requestConfig
    )

    const searchResults: SearchResult[] = []
    if (response.data?.output && Array.isArray(response.data.output)) {
      for (const outputItem of response.data.output) {
        if (
          outputItem.type === 'message' &&
          outputItem.role === 'assistant' &&
          outputItem.content &&
          Array.isArray(outputItem.content)
        ) {
          for (const contentItem of outputItem.content) {
            if (
              contentItem.type === 'output_text' &&
              contentItem.annotations &&
              Array.isArray(contentItem.annotations)
            ) {
              for (const annotation of contentItem.annotations) {
                if (annotation.type === 'url_citation') {
                  searchResults.push({
                    title: annotation.title || '',
                    url: annotation.url || '',
                    content: annotation.summary || '',
                    snippet: `${(annotation.summary || '').substring(0, 200)}...`,
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

    debug(
      config,
      `火山引擎搜索成功，找到 ${searchResults.length} 条结果 (模型: ${actualModel})`,
      'Search-Volcengine',
      'details'
    )
    return {
      success: true,
      results: searchResults,
      query,
      engine: 'volcengine',
      model: actualModel
    }
  } catch (error: any) {
    const errorMsg = `火山引擎搜索失败: ${error.message}`
    debug(config, errorMsg, 'Search-Volcengine', 'error')
    markVolcengineModelFailure(config, searchConfig, actualModel)

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