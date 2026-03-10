import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('../../src/utils/sanitizer', () => ({
  createSanitizer: jest.fn(() => ({
    isEnabled: () => false,
    sanitize: (value: string) => value,
  })),
}))

jest.mock('../../src/utils/media', () => ({
  getImageUrl: jest.fn(async (_ctx: unknown, _config: unknown, _http: unknown, src: string) => `mocked:${src}`),
  getVideoUrl: jest.fn(async () => ''),
  puppeteerToFile: jest.fn(async (_ctx: unknown, _config: unknown, msg: string) => msg),
}))

import { RssItemProcessor } from '../../src/core/item-processor'
import { getImageUrl } from '../../src/utils/media'
import { Config, rssArg } from '../../src/types'

describe('RssItemProcessor', () => {
  let mockConfig: Config
  let mockHttp: jest.Mock<any>
  const mockGetImageUrl = getImageUrl as jest.MockedFunction<typeof getImageUrl>

  beforeEach(() => {
    jest.clearAllMocks()
    mockHttp = jest.fn()
    mockGetImageUrl.mockImplementation(async (_ctx: unknown, _config: unknown, _http: unknown, src: string) => `mocked:${src}`)
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
        content: '{{description}}',
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

  it('only image 模板应只解析唯一图片一次', async () => {
    const processor = new RssItemProcessor({} as any, mockConfig, mockHttp)

    const result = await processor.parseRssItem({
      title: '图片测试',
      description: '<p>封面</p><img src="https://example.com/a.png" /><img src="https://example.com/a.png" /><img src="https://example.com/b.png" />',
    }, {
      template: 'only image',
    } as rssArg, 'test-author')

    expect(mockGetImageUrl).toHaveBeenCalledTimes(2)
    expect(result).toContain('<img src="mocked:https://example.com/a.png"/>')
    expect(result).toContain('<img src="mocked:https://example.com/b.png"/>')
  })

  it('only media 模板应复用图片去重结果', async () => {
    const processor = new RssItemProcessor({} as any, mockConfig, mockHttp)

    const result = await processor.parseRssItem({
      title: '媒体测试',
      description: '<img src="https://example.com/a.png" /><img src="https://example.com/a.png" />',
    }, {
      template: 'only media',
    } as rssArg, 'test-author')

    expect(mockGetImageUrl).toHaveBeenCalledTimes(1)
    expect(result).toBe('<img src="mocked:https://example.com/a.png"/>')
  })

  it('content 模板应只解析唯一图片一次并在重复位置正确回填', async () => {
    const processor = new RssItemProcessor({} as any, mockConfig, mockHttp)

    const result = await processor.parseRssItem({
      title: '正文测试',
      description: '前<img src="https://example.com/a.png"/>中<img src="https://example.com/a.png"/>后',
    }, {
      template: 'content',
    } as rssArg, 'test-author')

    expect(mockGetImageUrl).toHaveBeenCalledTimes(1)
    expect(result.split('mocked:https://example.com/a.png')).toHaveLength(3)
    expect(result).toContain('前')
    expect(result).toContain('中')
    expect(result).toContain('后')
  })
})