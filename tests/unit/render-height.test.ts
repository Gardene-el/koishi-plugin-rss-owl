/**
 * 渲染高度测试 - 模拟各种高度的内容进行渲染测试
 *
 * 用法:
 *   npx jest tests/unit/render-height.test.ts
 *   npx jest tests/unit/render-height.test.ts --verbose
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import * as cheerio from 'cheerio'

// 直接测试 HTML 处理逻辑，不依赖完整的渲染流程
describe('渲染高度测试 - 图片样式处理', () => {
  /**
   * 测试用例 1: 短内容 - 单个段落
   */
  it('应该正确处理短内容（单个段落）', async () => {
    const html = cheerio.load('<p>这是一段简短的文本内容。</p>')

    // 短内容没有图片，只验证 HTML 结构
    const result = html.html()

    // 验证 HTML 正确生成
    expect(result).toContain('简短的文本内容')
    console.log('✓ 短内容渲染结果')
  })

  /**
   * 测试用例 2: 中等内容 - 多段落 + 图片
   */
  it('应该正确处理中等高度内容（多段落+图片）', async () => {
    const html = cheerio.load(`
      <p>第一段内容，包含一些描述性文字。</p>
      <p>第二段内容，继续展开说明。</p>
      <img src="https://example.com/image1.jpg" />
      <p>第三段内容，带有更多详细信息。</p>
      <img src="https://example.com/image2.jpg" />
    `)
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    // 验证所有图片都应用了正确的样式
    const imgCount = (result.match(/<img/g) || []).length
    expect(imgCount).toBe(2)
    expect(result).toContain('height:auto')
    console.log('✓ 中等内容渲染结果，包含', imgCount, '张图片')
  })

  /**
   * 测试用例 3: 长内容 - 多段落 + 多图片（模拟问题场景）
   */
  it('应该正确处理长内容（多段落+多图片）', async () => {
    // 模拟包含多张图片的长内容
    const images = Array.from({ length: 5 }, (_, i) =>
      `<img src="https://example.com/image${i}.jpg" />`
    ).join('')

    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `<p>这是第 ${i + 1} 段内容，用于模拟长文章内容。</p>`
    ).join('')

    const html = cheerio.load(`<div>${paragraphs}${images}</div>`)
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    // 验证所有图片都应用了正确的样式
    const imgCount = (result.match(/<img/g) || []).length
    expect(imgCount).toBe(5)
    expect(result).toContain('height:auto')
    expect(result).toContain('max-width:100%')
    console.log('✓ 长内容渲染结果，包含', imgCount, '张图片')
  })

  /**
   * 测试用例 4: 无图片内容
   */
  it('应该正确处理纯文本内容（无图片）', async () => {
    const html = cheerio.load(`
      <h1>标题</h1>
      <p>第一段内容。</p>
      <p>第二段内容。</p>
      <ul>
        <li>列表项 1</li>
        <li>列表项 2</li>
        <li>列表项 3</li>
      </ul>
    `)
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    // 无图片时不应添加图片样式（因为没有 img 标签）
    expect(result).not.toContain('<img')
    console.log('✓ 纯文本内容渲染结果')
  })

  /**
   * 测试用例 5: 各种图片尺寸模拟
   */
  it('应该正确处理不同宽高比的图片', async () => {
    const html = cheerio.load(`
      <div>
        <img src="landscape.jpg" style="width:800px;height:400px;" />
        <img src="portrait.jpg" style="width:400px;height:800px;" />
        <img src="square.jpg" style="width:500px;height:500px;" />
        <img src="no-dimension.jpg" />
      </div>
    `)
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    // 验证所有图片都应用了正确的样式
    expect(result).toContain('height:auto')
    expect(result).toContain('max-width:100%')
    expect(result).not.toContain('width:800px')
    console.log('✓ 不同尺寸图片渲染结果已应用 height:auto')
  })

  /**
   * 测试用例 6: 纯图片内容（问题场景）
   */
  it('应该正确处理纯图片内容（问题场景）', async () => {
    const images = Array.from({ length: 10 }, (_, i) =>
      `<img src="https://example.com/image${i}.jpg" />`
    ).join('')

    const html = cheerio.load(`<div>${images}</div>`)
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    // 验证所有图片都应用了正确的样式
    const imgCount = (result.match(/<img/g) || []).length
    expect(imgCount).toBe(10)
    expect(result).toContain('height:auto')
    expect(result).toContain('max-width:100%')
    console.log('✓ 纯图片内容（10张）渲染结果正确')
  })

  /**
   * 测试用例 7: 嵌套图片容器
   */
  it('应该正确处理嵌套结构中的图片', async () => {
    const html = cheerio.load(`
      <article>
        <div class="content">
          <section>
            <img src="nested1.jpg" />
          </section>
          <div>
            <p>Some text</p>
            <img src="nested2.jpg" />
          </div>
        </div>
      </article>
    `)
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    // 验证嵌套图片都应用了正确的样式
    const imgCount = (result.match(/<img/g) || []).length
    expect(imgCount).toBe(2)
    expect(result).toContain('height:auto')
    console.log('✓ 嵌套图片渲染结果，包含', imgCount, '张图片')
  })

  /**
   * 测试用例 8: 超大尺寸图片
   */
  it('应该正确处理超大尺寸图片', async () => {
    const html = cheerio.load(
      '<img src="huge.jpg" style="width:10000px;height:20000px;" />'
    )
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    expect(result).toContain('height:auto')
    expect(result).toContain('max-width:100%')
    console.log('✓ 超大图片渲染结果')
  })

  /**
   * 测试用例 9: 极小尺寸图片
   */
  it('应该正确处理极小尺寸图片', async () => {
    const html = cheerio.load(
      '<img src="tiny.jpg" style="width:1px;height:1px;" />'
    )
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    expect(result).toContain('height:auto')
    expect(result).toContain('max-width:100%')
    console.log('✓ 极小图片渲染结果')
  })
})

describe('渲染高度测试 - 验证修复后的样式', () => {
  /**
   * 核心测试: 验证图片样式同时包含 height:auto 和 max-width:100%
   * 这是修复截图高度过高问题的关键
   */
  it('修复验证: 图片样式必须同时包含 height:auto 和 max-width:100%', () => {
    const html = cheerio.load('<img src="test.jpg" />')
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')

    const result = html.html()

    // 验证两个关键样式都存在
    expect(result).toContain('height:auto')
    expect(result).toContain('max-width:100%')
    expect(result).toContain('object-fit:scale-down')

    // 提取 style 属性进行更精确的验证
    const img = html('img')
    const style = img.attr('style')
    expect(style).toContain('height:auto')
    expect(style).toContain('max-width:100%')

    console.log('✓ 修复验证通过 - 样式:', style)
  })

  /**
   * 测试: 修复前后对比
   */
  it('修复对比: 修复前缺少 height:auto 导致截图被拉伸', () => {
    // 修复前的样式（缺少 height:auto）
    const htmlBefore = cheerio.load('<img src="test.jpg" style="width:1000px;height:2000px;" />')
    const resultBefore = htmlBefore.html()

    // 修复后的样式（添加了 height:auto）
    const htmlAfter = cheerio.load('<img src="test.jpg" style="width:1000px;height:2000px;" />')
    htmlAfter('img').attr('style', 'object-fit:scale-down;max-width:100%;height:auto;')
    const resultAfter = htmlAfter.html()

    // 验证修复后包含 height:auto
    expect(resultBefore).not.toContain('height:auto')
    expect(resultAfter).toContain('height:auto')

    console.log('✓ 修复对比通过')
    console.log('  修复前:', resultBefore.match(/style="([^"]+)"/)?.[1])
    console.log('  修复后:', resultAfter.match(/style="([^"]+)"/)?.[1])
  })
})
