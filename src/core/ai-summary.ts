import { Config } from '../types'
import { debug } from '../utils/logger'
import { AiSummaryCache, getOrInitAiCache } from './ai-cache'
import { callAiApi } from './ai-client'
import {
  buildBatchSummaryPrompt,
  buildSingleSummaryPrompt,
  cleanHtmlContent,
  cleanSummaryItems,
  enhancePromptWithSearch
} from './ai-utils'

function shouldSkipAiSummary(config: Config): boolean {
  return !config.ai?.enabled || !config.ai?.apiKey
}

function getSummaryCache(config: Config): AiSummaryCache {
  return getOrInitAiCache(undefined, config.security?.maxCacheSize)
}

export async function getAiSummary(
  config: Config,
  title: string,
  contentHtml: string
): Promise<string> {
  if (shouldSkipAiSummary(config)) return ''

  const cache = getSummaryCache(config)
  const plainText = cleanHtmlContent(contentHtml, config.ai!.maxInputLength!)
  if (!plainText || plainText.length < 50) return ''

  const cachedSummary = cache.get(title, plainText)
  if (cachedSummary) {
    debug(config, `使用缓存的 AI 摘要: ${title}`, 'AI-Cache', 'details')
    return cachedSummary
  }

  let prompt = buildSingleSummaryPrompt(config.ai!.prompt!, title, plainText)
  const searchQuery = title || plainText.substring(0, 100)
  prompt = await enhancePromptWithSearch(config, prompt, searchQuery)

  const result = await callAiApi(config, prompt, `单条摘要: ${title}`)
  if (result.success && result.summary) {
    cache.set(title, plainText, result.summary)
  }

  return result.summary
}

export async function getBatchAiSummary(
  config: Config,
  items: Array<{ title: string; content: string }>
): Promise<string> {
  if (shouldSkipAiSummary(config) || items.length === 0) return ''
  if (items.length === 1) {
    return getAiSummary(config, items[0].title, items[0].content)
  }

  debug(config, `批量生成 AI 摘要: ${items.length} 条内容`, 'AI-Batch', 'info')

  try {
    const cleanedItems = cleanSummaryItems(items, config.ai!.maxInputLength!)
    if (cleanedItems.length === 0) {
      debug(config, '所有内容都太短，无法生成批量摘要', 'AI-Batch', 'info')
      return ''
    }

    let prompt = buildBatchSummaryPrompt(cleanedItems)
    prompt = await enhancePromptWithSearch(config, prompt, cleanedItems[0].title, '批量摘要 - ')

    const result = await callAiApi(config, prompt, `批量摘要: ${cleanedItems.length}条`)
    if (result.success && result.summary) {
      debug(config, `批量摘要生成成功: ${result.summary.substring(0, 50)}...`, 'AI-Batch', 'details')
    }

    return result.summary
  } catch (error: any) {
    debug(config, `批量摘要生成失败: ${error.message}`, 'AI-Batch', 'error')
    return ''
  }
}

export async function getSmartAiSummary(
  config: Config,
  items: Array<{ title: string; content: string }>
): Promise<string> {
  if (shouldSkipAiSummary(config) || items.length === 0) {
    return ''
  }

  const threshold = 3
  if (items.length > threshold) {
    return getBatchAiSummary(config, items)
  }

  const summaries = await Promise.all(
    items.map(item => getAiSummary(config, item.title, item.content))
  )
  return summaries.filter(summary => summary).join('\n\n')
}