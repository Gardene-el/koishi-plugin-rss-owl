import * as cheerio from 'cheerio'

import { Config } from '../types'
import { debug } from '../utils/logger'
import { requestAiText } from './ai-client'

export async function generateSelectorByAI(
  config: Config,
  url: string,
  instruction: string,
  html: string
): Promise<string> {
  if (!config.ai?.enabled || !config.ai?.apiKey) {
    throw new Error('需在配置中开启 AI 功能并填写 API Key')
  }

  const $ = cheerio.load(html)
  $('script, style, svg, path, link, meta, noscript').remove()
  $('*').contents().each((_, element) => {
    if (element.type === 'comment') {
      $(element).remove()
    }
  })

  const cleanHtml = $('body').html()?.replace(/\s+/g, ' ').trim().substring(0, 15000) || ''
  const prompt = `
    作为一名爬虫专家，请根据提供的 HTML 代码片段，为一个网页监控工具生成一个 CSS Selector。

    目标网页：${url}
    用户需求：${instruction}

    要求：
    1. 只返回 CSS Selector 字符串，不要包含任何解释、Markdown 标记或代码块符号。
    2. Selector 必须尽可能精确，通常用于提取列表中的一项或多项。
    3. 如果是列表，请确保 Selector 能选中列表项的容器。

    HTML片段：
    ${cleanHtml}
    `

  try {
    debug(config, `正在请求 AI 生成选择器: ${instruction}`, 'AI-Selector', 'info')

    let selector = await requestAiText(config, prompt, {
      temperature: 0.1,
      timeout: 60000
    })

    selector = selector.replace(/`/g, '').replace(/^css/i, '').trim()
    debug(config, `AI 生成的选择器: ${selector}`, 'AI-Selector', 'info')
    return selector || ''
  } catch (error: any) {
    debug(config, `AI 生成选择器失败: ${error.message}`, 'AI-Selector', 'error')
    throw error
  }
}