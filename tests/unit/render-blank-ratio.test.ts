/**
 * 渲染截图空白区域测试
 *
 * 测试标准：空白页面区域低于 20%
 *
 * 用法:
 *   npx jest tests/unit/render-blank-ratio.test.ts
 *   npx jest tests/unit/render-blank-ratio.test.ts --verbose
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

// 导入被测试的函数
import { calculateContentHeight, RenderContentMetrics } from '../../src/core/renderer'

describe('渲染截图空白区域测试 - 空白区域低于20%', () => {
  /**
   * 测试标准：空白区域 = (viewport高度 - 内容高度) / viewport高度 < 20%
   * 即：内容高度 / viewport高度 > 80%
   */

  /**
   * 测试用例 1: 短内容 - 内容接近视口
   * 预期空白区域 < 20%
   */
  it('短内容: 空白区域应低于20%', () => {
    // 模拟短内容场景：内容高度 150px，视口高度 200px
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 150,
      bodyOffsetHeight: 150,
      documentScrollHeight: 150,
      contentRangeHeight: 150,
      maxElementBottom: 130,
      paddingTop: 8,
      paddingBottom: 8,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 200,
    }

    const contentHeight = calculateContentHeight(metrics)
    const blankRatio = (metrics.viewportHeight - contentHeight) / metrics.viewportHeight

    console.log('短内容:', {
      viewportHeight: metrics.viewportHeight,
      contentHeight,
      blankRatio: (blankRatio * 100).toFixed(2) + '%',
    })

    expect(blankRatio).toBeLessThan(0.2)
    expect(contentHeight / metrics.viewportHeight).toBeGreaterThan(0.8)
  })

  /**
   * 测试用例 2: 中等内容 - 正常比例
   * 预期空白区域 < 20%
   */
  it('中等内容: 空白区域应低于20%', () => {
    // 模拟中等内容：内容高度 400px，视口高度 500px
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 400,
      bodyOffsetHeight: 400,
      documentScrollHeight: 400,
      contentRangeHeight: 380,
      maxElementBottom: 360,
      paddingTop: 16,
      paddingBottom: 16,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 500,
    }

    const contentHeight = calculateContentHeight(metrics)
    const blankRatio = (metrics.viewportHeight - contentHeight) / metrics.viewportHeight

    console.log('中等内容:', {
      viewportHeight: metrics.viewportHeight,
      contentHeight,
      blankRatio: (blankRatio * 100).toFixed(2) + '%',
    })

    expect(blankRatio).toBeLessThan(0.2)
  })

  /**
   * 测试用例 3: 长内容 - 内容高度超过视口
   * 预期：内容高度 = 实际内容高度，无空白
   */
  it('长内容: 内容高度超过视口时应使用实际内容高度', () => {
    // 模拟长内容：内容高度 1200px，视口高度 800px（内容超过视口）
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 1200,
      bodyOffsetHeight: 1200,
      documentScrollHeight: 1200,
      contentRangeHeight: 1150,
      maxElementBottom: 1130,
      paddingTop: 16,
      paddingBottom: 16,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 800,
    }

    const contentHeight = calculateContentHeight(metrics)

    console.log('长内容:', {
      viewportHeight: metrics.viewportHeight,
      contentHeight,
    })

    // 长内容不应该有空白（内容超过视口）
    expect(contentHeight).toBeGreaterThanOrEqual(metrics.viewportHeight)
    expect(contentHeight).toBe(1200) // 应该使用实际内容高度
  })

  /**
   * 测试用例 4: 纯图片内容 - 关键测试
   * 这是最容易出现问题的场景（修复前会导致截图过高）
   * 预期空白区域 < 20%
   */
  it('纯图片内容: 空白区域应低于20% (修复验证)', () => {
    // 模拟纯图片场景：5张图片，每张约 200px 高度
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 1050,
      bodyOffsetHeight: 1050,
      documentScrollHeight: 1050,
      contentRangeHeight: 1000,
      maxElementBottom: 980,
      paddingTop: 20,
      paddingBottom: 20,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 1100, // 初始视口
    }

    const contentHeight = calculateContentHeight(metrics)
    const blankRatio = (contentHeight - metrics.contentRangeHeight) / contentHeight

    console.log('纯图片内容 (修复后):', {
      viewportHeight: metrics.viewportHeight,
      contentRangeHeight: metrics.contentRangeHeight,
      contentHeight,
      blankRatio: (blankRatio * 100).toFixed(2) + '%',
    })

    // 验证内容高度计算正确
    expect(contentHeight).toBeGreaterThanOrEqual(1000) // 至少包含内容
    expect(blankRatio).toBeLessThan(0.2) // 空白区域 < 20%
  })

  /**
   * 测试用例 5: 边界情况 - 极小内容
   * 确保最小高度限制
   */
  it('极小内容: 应保持最小高度且空白比例计算正确', () => {
    // 模拟极小内容：内容高度只有 50px
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 50,
      bodyOffsetHeight: 50,
      documentScrollHeight: 50,
      contentRangeHeight: 40,
      maxElementBottom: 35,
      paddingTop: 8,
      paddingBottom: 8,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 2000, // 大视口
    }

    const contentHeight = calculateContentHeight(metrics)

    console.log('极小内容:', {
      viewportHeight: metrics.viewportHeight,
      contentRangeHeight: metrics.contentRangeHeight,
      contentHeight,
    })

    // 最小高度应为 100px
    expect(contentHeight).toBe(100)
  })

  /**
   * 测试用例 6: 修复前的场景模拟
   * 模拟修复前的问题：图片只有 max-width:100% 没有 height:auto
   * 导致浏览器计算出巨大的高度
   */
  it('修复前场景: 模拟图片被拉伸导致高度异常', () => {
    // 模拟修复前的问题：DOM 测量高度异常大
    const metricsBefore: RenderContentMetrics = {
      bodyScrollHeight: 5000, // 异常大的值（修复前的问题）
      bodyOffsetHeight: 5000,
      documentScrollHeight: 5000,
      contentRangeHeight: 500, // 实际内容只有 500px
      maxElementBottom: 480,
      paddingTop: 16,
      paddingBottom: 16,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 2000,
    }

    const contentHeight = calculateContentHeight(metricsBefore)

    console.log('修复前场景模拟:', {
      actualContentHeight: metricsBefore.contentRangeHeight,
      domMeasuredHeight: metricsBefore.bodyScrollHeight,
      calculatedHeight: contentHeight,
    })

    // 修复后应该使用实际内容高度，而非 DOM 测量高度
    // 当前 calculateContentHeight 逻辑已经能够正确处理这种情况
    expect(contentHeight).toBeLessThanOrEqual(600) // 应该接近实际内容高度
  })

  /**
   * 测试用例 7: 多图长内容
   * 10张图片 + 文字的混合场景
   */
  it('多图长内容: 空白区域应低于20%', () => {
    // 模拟 10 张图片 + 段落的场景
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 2500,
      bodyOffsetHeight: 2500,
      documentScrollHeight: 2500,
      contentRangeHeight: 2400,
      maxElementBottom: 2350,
      paddingTop: 20,
      paddingBottom: 20,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 2600,
    }

    const contentHeight = calculateContentHeight(metrics)
    const blankRatio = (metrics.viewportHeight - contentHeight) / metrics.viewportHeight

    console.log('多图长内容:', {
      viewportHeight: metrics.viewportHeight,
      contentHeight,
      blankRatio: (blankRatio * 100).toFixed(2) + '%',
    })

    expect(blankRatio).toBeLessThan(0.2)
  })

  /**
   * 测试用例 8: 内容与视口接近的场景
   * 验证空白比例计算正确
   */
  it('内容与视口接近: 空白区域应低于20%', () => {
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 780,
      bodyOffsetHeight: 780,
      documentScrollHeight: 780,
      contentRangeHeight: 750,
      maxElementBottom: 720,
      paddingTop: 16,
      paddingBottom: 16,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 800,
    }

    const contentHeight = calculateContentHeight(metrics)
    const blankRatio = (metrics.viewportHeight - contentHeight) / metrics.viewportHeight
    const contentRatio = contentHeight / metrics.viewportHeight

    console.log('内容与视口接近:', {
      viewportHeight: metrics.viewportHeight,
      contentHeight,
      contentRatio: (contentRatio * 100).toFixed(2) + '%',
      blankRatio: (blankRatio * 100).toFixed(2) + '%',
    })

    // 内容占比应 > 80%
    expect(contentRatio).toBeGreaterThan(0.8)
    expect(blankRatio).toBeLessThan(0.2)
  })
})

describe('渲染截图空白区域测试 - 边界情况', () => {
  /**
   * 边界测试 1: 视口高度为0
   */
  it('视口高度为0时应返回最小高度', () => {
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 0,
      bodyOffsetHeight: 0,
      documentScrollHeight: 0,
      contentRangeHeight: 0,
      maxElementBottom: 0,
      paddingTop: 0,
      paddingBottom: 0,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 0,
    }

    const contentHeight = calculateContentHeight(metrics)

    expect(contentHeight).toBe(100) // 最小高度
  })

  /**
   * 边界测试 2: 所有高度都为0
   */
  it('所有高度为0时应返回最小高度', () => {
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 0,
      bodyOffsetHeight: 0,
      documentScrollHeight: 0,
      contentRangeHeight: 0,
      maxElementBottom: 0,
      paddingTop: 0,
      paddingBottom: 0,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      bodyWidth: 0,
      viewportHeight: 0,
    }

    const contentHeight = calculateContentHeight(metrics)

    expect(contentHeight).toBe(100)
  })

  /**
   * 边界测试 3: 只有 margin 的情况
   */
  it('只有margin时应正确计算', () => {
    const metrics: RenderContentMetrics = {
      bodyScrollHeight: 100,
      bodyOffsetHeight: 100,
      documentScrollHeight: 100,
      contentRangeHeight: 80,
      maxElementBottom: 70,
      paddingTop: 0,
      paddingBottom: 0,
      marginTop: 20,
      marginBottom: 20,
      marginLeft: 0,
      bodyWidth: 600,
      viewportHeight: 200,
    }

    const contentHeight = calculateContentHeight(metrics)

    // 内容高度应该包含 margin (80 + 20 + 20 = 120)
    expect(contentHeight).toBe(120)
  })
})
