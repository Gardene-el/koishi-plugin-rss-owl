import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('../../src/utils/media', () => ({
  getImageUrl: jest.fn(),
}))

import { Config as ConfigSchema } from '../../src/config'
import { calculateContentHeight, preprocessHtmlImages } from '../../src/core/renderer'
import { getImageUrl } from '../../src/utils/media'
import { Config } from '../../src/types'

const mockGetImageUrl = getImageUrl as jest.MockedFunction<typeof getImageUrl>

describe('renderer', () => {
  let mockConfig: Config

  beforeEach(() => {
    jest.clearAllMocks()
    mockConfig = {
      debug: 'disable',
      basic: { imageMode: 'base64', autoSplitImage: false },
      template: { bodyWidth: 600, bodyPadding: 20, deviceScaleFactor: 1 },
      security: { sanitizeHtml: true },
    } as any
  })

  it('不应在模板预处理阶段移除 style 和 script 标签', async () => {
    const html = '<html><head><style>.card{color:red;}</style><script>window.test=1;</script></head><body><div class="card">content</div></body></html>'

    const result = await preprocessHtmlImages({} as any, mockConfig, jest.fn(), html)

    expect(result).toContain('<style>.card{color:red;}</style>')
    expect(result).toContain('<script>window.test=1;</script>')
    expect(result).toContain('class="card"')
  })

  it('应继续将外部图片替换为 data url', async () => {
    mockGetImageUrl.mockResolvedValue('data:image/png;base64,mock-image')
    const html = '<html><body><img src="https://example.com/test.png" /></body></html>'

    const result = await preprocessHtmlImages({} as any, mockConfig, jest.fn(), html)

    expect(mockGetImageUrl).toHaveBeenCalledWith(
      {} as any,
      mockConfig,
      expect.any(Function),
      'https://example.com/test.png',
      {},
      true
    )
    expect(result).toContain('src="data:image/png;base64,mock-image"')
  })

  it('配置 Schema 应暴露 security.sanitizeHtml', () => {
    expect(Object.keys((ConfigSchema as any).dict.security.dict)).toContain('sanitizeHtml')
  })

  it('应优先使用实际内容高度，避免把大 viewport 误判为空白高度', () => {
    const height = calculateContentHeight({
      bodyScrollHeight: 2000,
      bodyOffsetHeight: 2000,
      documentScrollHeight: 2000,
      contentRangeHeight: 280,
      maxElementBottom: 300,
      paddingTop: 20,
      paddingBottom: 20,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 2000,
    })

    expect(height).toBe(340)
  })

  it('内容高度与 DOM 高度接近时应保留略大的值，避免截图被裁切', () => {
    const height = calculateContentHeight({
      bodyScrollHeight: 540,
      bodyOffsetHeight: 540,
      documentScrollHeight: 540,
      contentRangeHeight: 500,
      maxElementBottom: 500,
      paddingTop: 16,
      paddingBottom: 16,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 800,
    })

    expect(height).toBe(540)
  })
})