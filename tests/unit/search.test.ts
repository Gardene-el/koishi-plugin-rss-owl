import { describe, expect, it } from '@jest/globals'

import {
  buildPromptWithSearchContext,
  formatSearchResults,
  webSearch
} from '../../src/core/search'
import { Config, SearchConfig } from '../../src/types'

const baseConfig: Config = {
  ai: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'test-model',
    timeout: 1000
  },
  net: {
    proxyAgent: {
      enabled: false
    }
  },
  debug: 'disable'
}

describe('Search 格式化辅助函数', () => {
  it('应格式化搜索结果为 AI 可读文本', () => {
    const text = formatSearchResults({
      success: true,
      query: '测试查询',
      engine: 'tavily',
      results: [{
        title: '结果标题',
        url: 'https://example.com',
        snippet: '摘要内容',
        publishedDate: '2026-03-10'
      }]
    })

    expect(text).toContain('联网搜索结果 (tavily)')
    expect(text).toContain('结果标题')
    expect(text).toContain('https://example.com')
    expect(text).toContain('摘要内容')
    expect(text).toContain('2026-03-10')
  })

  it('无结果时应返回空字符串', () => {
    expect(formatSearchResults({
      success: false,
      query: '测试查询',
      engine: 'tavily',
      results: []
    })).toBe('')
  })

  it('应将搜索上下文追加到原始 Prompt', () => {
    const prompt = buildPromptWithSearchContext(
      '原始提示词',
      {
        success: true,
        query: '测试查询',
        engine: 'searxng',
        results: [{
          title: '搜索结果',
          url: 'https://example.com/news',
          snippet: '外部搜索摘要'
        }]
      },
      '测试查询'
    )

    expect(prompt).toContain('原始提示词')
    expect(prompt).toContain('搜索结果')
    expect(prompt).toContain('【搜索结果使用原则】')
  })
})

describe('webSearch 边界分支', () => {
  it('未启用搜索时应直接返回错误响应', async () => {
    const result = await webSearch(baseConfig, '测试查询', { enabled: false })
    expect(result.success).toBe(false)
    expect(result.engine).toBe('none')
    expect(result.error).toBe('联网搜索未启用')
  })

  it('缺少 Tavily Key 时应返回配置错误', async () => {
    const result = await webSearch(baseConfig, '测试查询', {
      enabled: true,
      engine: 'tavily'
    })

    expect(result.success).toBe(false)
    expect(result.engine).toBe('tavily')
    expect(result.error).toBe('Tavily API Key 未配置')
  })

  it('缺少 SearXNG 地址时应返回配置错误', async () => {
    const result = await webSearch(baseConfig, '测试查询', {
      enabled: true,
      engine: 'searxng'
    })

    expect(result.success).toBe(false)
    expect(result.engine).toBe('searxng')
    expect(result.error).toBe('SearXNG 实例 URL 未配置')
  })

  it('缺少火山引擎 Key 时应返回配置错误', async () => {
    const result = await webSearch(baseConfig, '测试查询', {
      enabled: true,
      engine: 'volcengine'
    })

    expect(result.success).toBe(false)
    expect(result.engine).toBe('volcengine')
    expect(result.error).toBe('火山引擎 API Key 未配置')
  })

  it('auto 模式无可用引擎时应返回错误', async () => {
    const config: SearchConfig = {
      enabled: true,
      engine: 'auto',
      enginePriority: ['tavily', 'volcengine', 'searxng']
    }

    const result = await webSearch(baseConfig, '测试查询', config)
    expect(result.success).toBe(false)
    expect(result.engine).toBe('auto')
    expect(result.error).toBe('没有配置任何可用的搜索引擎')
  })

  it('未知引擎时应返回 unknown', async () => {
    const result = await webSearch(baseConfig, '测试查询', {
      enabled: true,
      engine: 'unknown' as any
    })

    expect(result.success).toBe(false)
    expect(result.engine).toBe('unknown')
    expect(result.error).toContain('未知的搜索引擎')
  })
})