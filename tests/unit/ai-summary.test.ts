import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import axios from 'axios'

import { clearAiCache, getAiSummary, getSmartAiSummary } from '../../src/core/ai'
import { Config } from '../../src/types'

const baseConfig: Config = {
  ai: {
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
    prompt: '标题：{{title}}\n内容：{{content}}',
    maxInputLength: 500,
    timeout: 1000,
    placement: 'top',
    separator: '----------------'
  },
  net: {
    proxyAgent: {
      enabled: false
    }
  },
  security: {
    maxCacheSize: 100
  },
  debug: 'disable'
}

describe('AI 摘要主线', () => {
  beforeEach(() => {
    clearAiCache()
    jest.restoreAllMocks()
  })

  afterEach(() => {
    clearAiCache()
    jest.restoreAllMocks()
  })

  it('AI 未启用时应返回空字符串', async () => {
    const config: Config = {
      ...baseConfig,
      ai: {
        ...baseConfig.ai,
        enabled: false
      }
    }

    const result = await getAiSummary(config, '测试标题', `<p>${'内容'.repeat(40)}</p>`)
    expect(result).toBe('')
  })

  it('内容过短时不应调用 AI 接口', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { choices: [{ message: { content: '不应被调用' } }] }
    } as any)

    const result = await getAiSummary(baseConfig, '短内容', '<p>太短了</p>')
    expect(result).toBe('')
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('搜索增强失败时不应阻断摘要生成', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { choices: [{ message: { content: '正常摘要' } }] }
    } as any)

    const config: Config = {
      ...baseConfig,
      search: {
        enabled: true,
        engine: 'tavily',
        maxResults: 5
      }
    }

    const result = await getAiSummary(config, '新闻标题', `<p>${'这是一个足够长的新闻正文'.repeat(20)}</p>`)
    expect(result).toBe('正常摘要')
    expect(postSpy).toHaveBeenCalledTimes(1)
  })

  it('智能摘要在超过阈值时应走批量摘要', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { choices: [{ message: { content: '批量摘要结果' } }] }
    } as any)

    const result = await getSmartAiSummary(
      baseConfig,
      Array.from({ length: 4 }, (_, index) => ({
        title: `标题${index + 1}`,
        content: `<p>${'批量内容'.repeat(40)}</p>`
      }))
    )

    expect(result).toBe('批量摘要结果')
    expect(postSpy).toHaveBeenCalledTimes(1)
  })

  it('智能摘要在阈值内时应逐条生成并合并', async () => {
    const postSpy = jest.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '摘要一' } }] } } as any)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '摘要二' } }] } } as any)

    const result = await getSmartAiSummary(baseConfig, [
      { title: '标题1', content: `<p>${'正文一'.repeat(40)}</p>` },
      { title: '标题2', content: `<p>${'正文二'.repeat(40)}</p>` }
    ])

    expect(result).toBe('摘要一\n\n摘要二')
    expect(postSpy).toHaveBeenCalledTimes(2)
  })
})