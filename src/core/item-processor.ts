import * as cheerio from 'cheerio'
import { Context } from 'koishi'

import { Config, rssArg } from '../types'
import { debug } from '../utils/logger'
import { createSanitizer } from '../utils/sanitizer'
import { getAiSummary } from './ai'
import { processItemTemplate } from './item-processor-template'
import { ItemProcessorRuntimeDeps, normalizeText } from './item-processor-runtime'

export class RssItemProcessor {
  constructor(
    private ctx: Context,
    private config: Config,
    private $http: any,
  ) { }

  private getRuntimeDeps(): ItemProcessorRuntimeDeps {
    return {
      ctx: this.ctx,
      config: this.config,
      $http: this.$http,
    }
  }

  async parseRssItem(
    item: any,
    arg: rssArg,
    authorId: string | number,
  ): Promise<string> {
    void authorId

    debug(this.config, arg, 'rss arg', 'details')
    let template = arg.template

    item.title = normalizeText(item?.title)
    item.description = normalizeText(item?.description)

    const sanitizer = createSanitizer(this.config)
    if (sanitizer.isEnabled() && item.description) {
      item.description = sanitizer.sanitize(item.description)
    }

    let aiSummary = ''
    let formattedAiSummary = ''
    const hasCustomAiTemplate = this.config.template?.custom?.includes('{{aiSummary}}')
      || this.config.template?.content?.includes('{{aiSummary}}')

    if (this.config.ai?.enabled) {
      const rawSummary = await getAiSummary(this.config, item.title, item.description)
      if (rawSummary) {
        aiSummary = rawSummary
        formattedAiSummary = `🤖 AI摘要：\n${rawSummary}`
        item.aiSummary = aiSummary
      }
    }

    arg.block?.forEach((blockWord: string) => {
      item.description = normalizeText(item.description).replace(
        new RegExp(blockWord, 'gim'),
        matched => Array(matched.length).fill(this.config.msg?.blockString || '*').join(''),
      )
      item.title = normalizeText(item.title).replace(
        new RegExp(blockWord, 'gim'),
        matched => Array(matched.length).fill(this.config.msg?.blockString || '*').join(''),
      )
    })

    const html = cheerio.load(item.description)
    if (this.config.basic?.videoMode === 'filter' && html('video').length > 0) {
      return ''
    }

    if (template === 'auto') {
      template = html.text().length < 300 ? 'content' : 'custom'
    }

    if (template) {
      debug(this.config, `使用模板: ${template}`, 'template', 'info')
    }

    let msg = await processItemTemplate({
      deps: this.getRuntimeDeps(),
      template,
      item,
      arg,
      html,
      aiSummary,
    })

    const imageMode = this.config.basic?.imageMode
    const isImageRenderTemplate = template === 'custom'
      || template === 'default'
      || template === 'only description'
    if (isImageRenderTemplate && ['base64', 'File', 'assets'].includes(imageMode || '')) {
      formattedAiSummary = ''
    }

    if (this.config.msg?.censor) {
      msg = `<censor>${msg}</censor>`
    }

    if (formattedAiSummary && !hasCustomAiTemplate && this.config.ai) {
      const sep = this.config.ai.separator || '----------------'
      msg = this.config.ai.placement === 'bottom'
        ? `${msg}\n${sep}\n${formattedAiSummary}`
        : `${formattedAiSummary}\n${sep}\n${msg}`
    }

    debug(this.config, msg, 'parse:msg', 'info')
    return msg
  }
}