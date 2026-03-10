import * as cheerio from 'cheerio'

import { normalizeSearchConfig } from '../config'
import { Config } from '../types'
import { debug } from '../utils/logger'
import { buildPromptWithSearchContext } from './search-format'
import { webSearch } from './search-service'

export interface AiSummaryItem {
  title: string
  content: string
}

export function cleanHtmlContent(contentHtml: string, maxLength: number): string {
  const $ = cheerio.load(contentHtml || '')
  $('script').remove()
  $('style').remove()
  $('img').remove()
  $('video').remove()

  let plainText = $.text().replace(/\s+/g, ' ').trim()
  if (plainText.length > maxLength) {
    plainText = plainText.substring(0, maxLength) + '...'
  }

  return plainText
}

export function buildSingleSummaryPrompt(
  promptTemplate: string,
  title: string,
  plainText: string
): string {
  return promptTemplate
    .replace('{{title}}', title || '')
    .replace('{{content}}', plainText)
}

export function buildBatchSummaryPrompt(items: AiSummaryItem[]): string {
  return `请简要总结以下 ${items.length} 条新闻/文章的核心内容，要求：
1. 语言简洁流畅，每条总结不超过30字
2. 按顺序总结，使用数字编号
3. 突出重点信息

${items.map((item, index) => `
${index + 1}. 标题：${item.title}
   内容：${item.content}
`).join('\n')}

总结：`
}

export function cleanSummaryItems(
  items: AiSummaryItem[],
  maxInputLength: number
): AiSummaryItem[] {
  return items
    .map(item => ({
      title: item.title,
      content: cleanHtmlContent(item.content, maxInputLength / items.length)
    }))
    .filter(item => item.content.length >= 50)
}

export async function enhancePromptWithSearch(
  config: Config,
  prompt: string,
  searchQuery: string,
  logPrefix = ''
): Promise<string> {
  if (!config.search?.enabled) {
    return prompt
  }

  try {
    const normalizedSearchConfig = normalizeSearchConfig(config.search)
    debug(config, `${logPrefix}正在联网搜索: ${searchQuery}`, 'AI-Search', 'info')

    const searchResults = await webSearch(config, searchQuery, normalizedSearchConfig)
    if (searchResults.success && searchResults.results.length > 0) {
      debug(
        config,
        `${logPrefix}联网搜索成功，找到 ${searchResults.results.length} 条结果`,
        'AI-Search',
        'details'
      )
      return buildPromptWithSearchContext(prompt, searchResults, searchQuery)
    }

    if (searchResults.error) {
      debug(config, `${logPrefix}联网搜索失败: ${searchResults.error}`, 'AI-Search', 'info')
    }
  } catch (error: any) {
    debug(config, `${logPrefix}联网搜索异常: ${error.message}`, 'AI-Search', 'error')
  }

  return prompt
}