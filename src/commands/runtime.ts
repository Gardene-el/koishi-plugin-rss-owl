import { Context } from 'koishi'

import type { Config, rssArg } from '../types'
import { quickList } from '../constants'
import { generateSelectorByAI } from '../core/ai'
import { formatArg, mixinArg } from '../core/feeder'
import { RssItemProcessor } from '../core/item-processor'
import { getRssData } from '../core/parser'
import { parsePubDate, parseQuickUrl } from '../utils/common'
import { debug } from '../utils/logger'

type DebugType = 'disable' | 'error' | 'info' | 'details'

export interface CommandRuntimeDeps {
  debug: (message: any, name?: string, type?: DebugType, context?: Record<string, any>) => void
  parseQuickUrl: (url: string) => string
  parsePubDate: (pubDate: any) => Date
  getRssData: (url: string, arg: Record<string, any>) => Promise<any[]>
  parseRssItem: (item: any, arg: Record<string, any>, authorId: string | number) => Promise<string>
  formatArg: (options: Record<string, any>) => rssArg
  mixinArg: (arg: Record<string, any>) => rssArg
  generateSelectorByAI: (url: string, instruction: string, html: string) => Promise<string>
  fetchUrl: (url: string, arg?: Record<string, any>) => Promise<string>
}

export function createCommandRuntimeDeps(
  ctx: Context,
  config: Config,
  $http: any,
  processor: RssItemProcessor,
): CommandRuntimeDeps {
  return {
    debug: (message: any, name = '', type: DebugType = 'details', context?: Record<string, any>) => {
      debug(config, message, name, type, context)
    },
    parseQuickUrl: (url: string) => parseQuickUrl(url, config.msg?.rssHubUrl, quickList),
    parsePubDate: (pubDate: any) => parsePubDate(config, pubDate),
    getRssData: (url: string, arg: Record<string, any>) => getRssData(ctx, config, $http, url, arg),
    parseRssItem: (item: any, arg: Record<string, any>, authorId: string | number) => processor.parseRssItem(item, arg, authorId),
    formatArg: (options: Record<string, any>) => formatArg(options, config),
    mixinArg: (arg: Record<string, any>) => mixinArg(arg, config),
    generateSelectorByAI: (url: string, instruction: string, html: string) => generateSelectorByAI(config, url, instruction, html),
    fetchUrl: async (url: string, arg: Record<string, any> = {}) => {
      const response = await $http(url, arg)
      return String(response?.data ?? '')
    },
  }
}