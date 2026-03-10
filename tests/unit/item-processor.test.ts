import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('../../src/utils/sanitizer', () => ({
  createSanitizer: jest.fn(() => ({
    isEnabled: () => false,
    sanitize: (value: string) => value,
  })),
}))

import { RssItemProcessor } from '../../src/core/item-processor'
import { Config, rssArg } from '../../src/types'

describe('RssItemProcessor', () => {
  let mockConfig: Config
  let mockHttp: jest.Mock<any>

  beforeEach(() => {
    jest.clearAllMocks()
    mockHttp = jest.fn()
    mockConfig = {
      basic: {
        imageMode: 'File',
        videoMode: 'href',
        usePoster: false,
      },
      template: {
        bodyWidth: 600,
        bodyPadding: 20,
        deviceScaleFactor: 1,
      },
      msg: {
        blockString: '*',
      },
      security: {
        enabled: false,
        sanitizeHtml: false,
      },
      debug: 'disable',
    } as any
  })

  it('标题和描述缺失时，only text 模板配合 block 不应崩溃', async () => {
    const processor = new RssItemProcessor({} as any, mockConfig, mockHttp)

    const result = await processor.parseRssItem({ title: undefined, description: undefined }, {
      template: 'only text',
      block: ['广告'],
    } as rssArg, 'test-author')

    expect(result).toBe('')
    expect(mockHttp).not.toHaveBeenCalled()
  })

  it('link 模板在没有 a 标签和 item.link 时应回退原始描述', async () => {
    const processor = new RssItemProcessor({} as any, mockConfig, mockHttp)

    const result = await processor.parseRssItem({
      title: '示例标题',
      description: '<p>原始描述</p>',
    }, {
      template: 'link',
    } as rssArg, 'test-author')

    expect(result).toBe('<p>原始描述</p>')
    expect(mockHttp).not.toHaveBeenCalled()
  })

  it('link 模板在没有 a 标签但存在 item.link 时应回退使用 item.link', async () => {
    mockHttp.mockResolvedValue({
      data: '<html><body><article>详情页内容</article></body></html>',
    })
    const processor = new RssItemProcessor({} as any, mockConfig, mockHttp)

    const result = await processor.parseRssItem({
      title: '示例标题',
      description: '<p>摘要</p>',
      link: 'https://example.com/post',
    }, {
      template: 'link',
      bodyWidth: 480,
      bodyPadding: 16,
    } as rssArg, 'test-author')

    expect(mockHttp).toHaveBeenCalledWith('https://example.com/post', expect.objectContaining({
      template: 'link',
      bodyWidth: 480,
      bodyPadding: 16,
    }))
    expect(result).toContain('<article>')
    expect(result).toContain('</article>')
    expect(result).toContain('&#x8be6;&#x60c5;&#x9875;&#x5185;&#x5bb9;')
    expect(result).toContain('style="width:480px;padding:16px;"')
  })
})