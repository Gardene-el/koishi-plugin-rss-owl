import { Context, h } from 'koishi'
import * as cheerio from 'cheerio'
import { Config, rssArg } from '../types'
import { debug } from '../utils/logger'
import { parseTemplateContent } from '../utils/common'
import { getImageUrl, getVideoUrl, puppeteerToFile } from '../utils/media'
import { renderHtml2Image, preprocessHtmlImages } from './renderer'
import { getDefaultTemplate, getDescriptionTemplate } from '../utils/template'
import { getAiSummary } from './ai'
import { marked } from 'marked'
import { createSanitizer } from '../utils/sanitizer'
import { validateUrlOrThrow, SecurityError, getSecurityOptions } from '../utils/security'

export class RssItemProcessor {
  constructor(
    private ctx: Context,
    private config: Config,
    private $http: any
  ) { }

  async parseRssItem(item: any, arg: rssArg, authorId: string | number): Promise<string> {
    debug(this.config, arg, 'rss arg', 'details');
    let template = arg.template;
    let msg = "";
    let html: any;
    let videoList: any[] = [];
    item.description = item.description?.join?.('') || item.description;

    // HTML 安全清理
    const sanitizer = createSanitizer(this.config)
    if (sanitizer.isEnabled() && item.description) {
      item.description = sanitizer.sanitize(item.description)
    }

    // --- AI 逻辑 START ---
    let aiSummary = "";
    let formattedAiSummary = "";
    const hasCustomAiTemplate = this.config.template?.custom?.includes('{{aiSummary}}') ||
      this.config.template?.content?.includes('{{aiSummary}}');

    if (this.config.ai && this.config.ai.enabled) {
      const rawSummary = await getAiSummary(this.config, item.title, item.description);

      if (rawSummary) {
        const prefix = "🤖 AI摘要：\n";
        const sep = this.config.ai?.separator || '----------------';

        // 带格式的摘要文本
        formattedAiSummary = `${prefix}${rawSummary}`;

        // 注入模板变量的纯文本
        aiSummary = rawSummary;

        // 将 aiSummary 添加到 item 对象中，供模板使用
        item.aiSummary = aiSummary;
      }
    }
    // --- AI 逻辑 END ---

    //block
    arg.block?.forEach((blockWord: string) => {
      item.description = item.description.replace(new RegExp(blockWord, 'gim'), i => Array(i.length).fill(this.config.msg?.blockString || '*').join(""));
      item.title = item.title.replace(new RegExp(blockWord, 'gim'), i => Array(i.length).fill(this.config.msg?.blockString || '*').join(""));
    });

    if (this.config.basic?.videoMode === 'filter') {
      html = cheerio.load(item.description);
      if (html('video').length > 0) return '';
    }

    html = cheerio.load(item.description);
    if (template == 'auto') {
      let stringLength = html.text().length;
      template = stringLength < 300 ? 'content' : 'custom';
    }

    // 在确定最终模板后才记录日志
    if (template) {
      debug(this.config, `使用模板: ${template}`, 'template', 'info');
    }

    msg = await this.processTemplate(template, item, arg, html, videoList, aiSummary);

    // 如果是图片渲染模板，AI摘要已经被注入到HTML中，不需要再自动拼接
    const isImageRenderTemplate = template === 'custom' || template === 'default' || template === 'only description';
    if (isImageRenderTemplate && (this.config.basic?.imageMode === 'base64' || this.config.basic?.imageMode === 'File' || this.config.basic?.imageMode === 'assets')) {
      formattedAiSummary = '';
    }

    if (this.config.msg?.censor) {
      msg = `<censor>${msg}</censor>`;
    }

    // --- AI 自动拼接逻辑 START ---
    // 如果生成了摘要，且用户使用的模板里没有显式包含 {{aiSummary}}，则自动拼接
    if (formattedAiSummary && !hasCustomAiTemplate && this.config.ai) {
      const sep = this.config.ai?.separator || '----------------';
      if (this.config.ai?.placement === 'bottom') {
        // 底部：正文 + 分割线 + 摘要
        msg = msg + `\n${sep}\n` + formattedAiSummary;
      } else {
        // 顶部：摘要 + 分割线 + 正文
        msg = formattedAiSummary + `\n${sep}\n` + msg;
      }
    }
    // --- AI 自动拼接逻辑 END ---

    debug(this.config, msg, "parse:msg", 'info');
    return msg;
  }

  private async processTemplate(
    template: string,
    item: any,
    arg: rssArg,
    html: any,
    videoList: any[],
    aiSummary: string
  ): Promise<string> {
    let msg = "";

    const parseContent = (templateStr: string, itemObj: any) =>
      parseTemplateContent(templateStr, { ...itemObj, aiSummary });

    switch (template) {
      case "custom":
        msg = await this.processCustomTemplate(item, arg, html, parseContent);
        await this.processVideos(html, arg, videoList);
        msg += this.formatVideoList(videoList);
        break;

      case "content":
        msg = await this.processContentTemplate(item, arg, html, parseContent);
        await this.processVideos(html, arg, videoList);
        msg += this.formatVideoList(videoList);
        msg += videoList.filter(([src, poster]) => poster && !src.startsWith('__VIDEO_LINK__')).map(([src, poster]) => h('img', { src: poster })).join("");
        break;

      case "only text":
        msg = html.text();
        break;

      case "only media":
        msg = await this.processOnlyMediaTemplate(item, arg, html);
        await this.processVideos(html, arg, videoList);
        msg += this.formatVideoList(videoList);
        break;

      case "only image":
        msg = await this.processOnlyImageTemplate(item, arg, html);
        break;

      case "only video":
        await this.processVideos(html, arg, videoList);
        msg = this.formatVideoList(videoList);
        break;

      case "proto":
        msg = item.description;
        break;

      case "default":
        msg = await this.processDefaultTemplate(item, arg, html, parseContent);
        await this.processVideos(html, arg, videoList);
        msg += this.formatVideoList(videoList);
        break;

      case "only description":
        msg = await this.processOnlyDescriptionTemplate(item, arg, html, parseContent);
        await this.processVideos(html, arg, videoList);
        msg += this.formatVideoList(videoList);
        break;

      case "link":
        msg = await this.processLinkTemplate(item, arg);
        break;

      default:
        msg = item.description;
    }

    return msg;
  }

  private async processCustomTemplate(item: any, arg: rssArg, html: any, parseContent: any): Promise<string> {
    item.description = parseContent(this.config.template?.custom || '', { ...item, arg });
    debug(this.config, item.description, 'description');

    // 如果有AI摘要，在图片渲染前将其注入到HTML中
    const hasAiSummary = item.aiSummary && item.aiSummary.trim();
    if (hasAiSummary && (this.config.basic?.imageMode === 'base64' || this.config.basic?.imageMode === 'File' || this.config.basic?.imageMode === 'assets')) {
      // 将markdown转换为HTML
      const aiSummaryHtml = await marked(item.aiSummary);
      const aiSummarySection = `
        <div class="ai-summary-section mb-6">
          <div class="flex items-start gap-3 mb-3">
            <div class="mt-0.5 w-6 h-6 rounded-md bg-primary/10 flex flex-shrink-0 items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-primary">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <h3 class="text-sm font-bold text-slate-700">AI 摘要</h3>
          </div>
          <div class="pl-9 prose prose-slate prose-sm max-w-none">
            ${aiSummaryHtml}
          </div>
        </div>
        <div class="border-t border-slate-100 my-6"></div>
      `;
      item.description = aiSummarySection + item.description;
    }

    html = cheerio.load(item.description);
    if (arg?.proxyAgent?.enabled) {
      await Promise.all(html('img').map(async (v: any, i: any) => i.attribs.src = await getImageUrl(this.ctx, this.config, this.$http, i.attribs.src, arg, true)).get());
    }
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;');
    let msg = await this.renderImage(html.html(), arg);
    return parseContent(this.config.template?.customRemark || '', { ...item, arg, description: msg });
  }

  private async processContentTemplate(item: any, arg: rssArg, html: any, parseContent: any): Promise<string> {
    let imgList: string[] = [];
    html('img').map((key: any, i: any) => imgList.push(i.attribs.src));
    imgList = [...new Set(imgList)];
    let imgBufferList = Object.assign({}, ...(await Promise.all(imgList.map(async (src: string) => ({ [src]: await getImageUrl(this.ctx, this.config, this.$http, src, arg) })))));

    html('img').replaceWith((key: any, Dom: any) => `<p>$img{{${imgList[key]}}}</p>`);
    let msg = html.text();

    item.description = msg.replace(/\$img\{\{(.*?)\}\}/g, (match: string) => {
      let src = match.match(/\$img\{\{(.*?)\}\}/)[1];
      let finalUrl = imgBufferList[src];
      return finalUrl ? `<img src="${finalUrl}"/>` : '';
    });

    return parseContent(this.config.template?.content || '', { ...item, arg });
  }

  private async processOnlyMediaTemplate(item: any, arg: rssArg, html: any): Promise<string> {
    let imgList: string[] = [];
    html('img').map((key: any, i: any) => imgList.push(i.attribs.src));
    imgList = await Promise.all([...new Set(imgList)].map(async (src: string) => await getImageUrl(this.ctx, this.config, this.$http, src, arg)));

    return imgList.filter(Boolean).map(img => `<img src="${img}"/>`).join("");
  }

  private async processOnlyImageTemplate(item: any, arg: rssArg, html: any): Promise<string> {
    let imgList: string[] = [];
    html('img').map((key: any, i: any) => imgList.push(i.attribs.src));
    imgList = await Promise.all([...new Set(imgList)].map(async (src: string) => await getImageUrl(this.ctx, this.config, this.$http, src, arg)));

    return imgList.filter(Boolean).map(img => `<img src="${img}"/>`).join("");
  }

  private async processDefaultTemplate(item: any, arg: rssArg, html: any, parseContent: any): Promise<string> {
    item.description = parseContent(getDefaultTemplate(this.config, arg.bodyWidth, arg.bodyPadding, arg.bodyFontSize || this.config.template?.bodyFontSize), { ...item, arg });
    debug(this.config, item.description, 'description');

    // 如果有AI摘要，在图片渲染前将其注入到HTML中
    const hasAiSummary = item.aiSummary && item.aiSummary.trim();
    if (hasAiSummary && (this.config.basic?.imageMode === 'base64' || this.config.basic?.imageMode === 'File' || this.config.basic?.imageMode === 'assets')) {
      // 将markdown转换为HTML
      const aiSummaryHtml = await marked(item.aiSummary);
      const aiSummarySection = `
        <div class="ai-summary-section mb-6">
          <div class="flex items-start gap-3 mb-3">
            <div class="mt-0.5 w-6 h-6 rounded-md bg-primary/10 flex flex-shrink-0 items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-primary">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <h3 class="text-sm font-bold text-slate-700">AI 摘要</h3>
          </div>
          <div class="pl-9 prose prose-slate prose-sm max-w-none">
            ${aiSummaryHtml}
          </div>
        </div>
        <div class="border-t border-slate-100 my-6"></div>
      `;
      item.description = aiSummarySection + item.description;
    }

    html = cheerio.load(item.description);
    if (arg?.proxyAgent?.enabled) {
      await Promise.all(html('img').map(async (v: any, i: any) => i.attribs.src = await getImageUrl(this.ctx, this.config, this.$http, i.attribs.src, arg, true)).get());
    }
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;');
    debug(this.config, `当前 imageMode: ${this.config.basic?.imageMode}`, 'imageMode', 'info');

    let msg = await this.renderImage(html.html(), arg);
    return msg;
  }

  private async processOnlyDescriptionTemplate(item: any, arg: rssArg, html: any, parseContent: any): Promise<string> {
    item.description = parseContent(getDescriptionTemplate(this.config, arg.bodyWidth, arg.bodyPadding, arg.bodyFontSize || this.config.template?.bodyFontSize), { ...item, arg });
    debug(this.config, item.description, 'description');

    // 如果有AI摘要，在图片渲染前将其注入到HTML中
    const hasAiSummary = item.aiSummary && item.aiSummary.trim();
    if (hasAiSummary && (this.config.basic?.imageMode === 'base64' || this.config.basic?.imageMode === 'File' || this.config.basic?.imageMode === 'assets')) {
      // 将markdown转换为HTML
      const aiSummaryHtml = await marked(item.aiSummary);
      const aiSummarySection = `
        <div class="ai-summary-section mb-6">
          <div class="flex items-start gap-3 mb-3">
            <div class="mt-0.5 w-6 h-6 rounded-md bg-primary/10 flex flex-shrink-0 items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-primary">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <h3 class="text-sm font-bold text-slate-700">AI 摘要</h3>
          </div>
          <div class="pl-9 prose prose-slate prose-sm max-w-none" style="color: #475569; line-height: 1.6;">
            ${aiSummaryHtml}
          </div>
        </div>
        <div style="border-top: 1px solid #e2e8f0; margin: 24px 0;"></div>
      `;
      item.description = aiSummarySection + item.description;
    }

    html = cheerio.load(item.description);
    if (arg?.proxyAgent?.enabled) {
      await Promise.all(html('img').map(async (v: any, i: any) => i.attribs.src = await getImageUrl(this.ctx, this.config, this.$http, i.attribs.src, arg, true)).get());
    }
    html('img').attr('style', 'object-fit:scale-down;max-width:100%;');

    let msg = await this.renderImage(html.html(), arg);
    return msg;
  }

  private async processLinkTemplate(item: any, arg: rssArg): Promise<string> {
    let html = cheerio.load(item.description);
    let src = html('a')[0].attribs.href;
    debug(this.config, src, 'link src', 'info');

    // URL 安全验证
    try {
      validateUrlOrThrow(src, getSecurityOptions(this.config))
    } catch (error) {
      if (error instanceof SecurityError) {
        debug(this.config, `链接 URL 安全验证失败: ${error.message}`, 'security', 'error')
        return `链接安全验证失败: ${error.message}`
      }
      throw error
    }

    let html2 = cheerio.load((await this.$http(src, arg)).data);
    if (arg?.proxyAgent?.enabled) {
      await Promise.all(html2('img').map(async (v: any, i: any) => i.attribs.src = await getImageUrl(this.ctx, this.config, this.$http, i.attribs.src, arg, true)).get());
    }
    html2('img').attr('style', 'object-fit:scale-down;max-width:100%;');
    // link 模板使用订阅级参数设置 body 样式
    const bodyWidth = arg?.bodyWidth ?? this.config.template?.bodyWidth ?? 600
    const bodyPadding = arg?.bodyPadding ?? this.config.template?.bodyPadding ?? 20
    html2('body').attr('style', `width:${bodyWidth}px;padding:${bodyPadding}px;`);

    let msg = await this.renderImage(html2.xml(), arg);
    return msg;
  }

  private async processVideos(html: any, arg: rssArg, videoList: any[]): Promise<void> {
    await Promise.all(html('video').map(async (v: any, i: any) =>
      videoList.push([
        await getVideoUrl(this.ctx, this.config, this.$http, i.attribs.src, arg, true, i),
        (i.attribs.poster && this.config.basic?.usePoster) ? await getImageUrl(this.ctx, this.config, this.$http, i.attribs.poster, arg, true) : ""
      ])
    ).get());
  }

  private formatVideoList(videoList: any[]): string {
    return videoList.filter(([src]) => src).map(([src, poster]) => {
      // href 模式：返回视频链接文本
      if (src.startsWith('__VIDEO_LINK__:')) {
        const videoUrl = src.replace('__VIDEO_LINK__:', '')
        return `\n🎬 视频: ${videoUrl}\n`
      }
      // 其他模式：创建 video 元素
      return h('video', { src, poster })
    }).join('')
  }

  /**
   * 统一的图片渲染方法
   * 提取了 custom、default、only description、link 模板中重复的图片渲染逻辑
   */
  private async renderImage(htmlContent: string, arg: rssArg): Promise<string> {
    const imageMode = this.config.basic?.imageMode;

    // base64 模式
    if (imageMode === 'base64') {
      debug(this.config, '使用 base64 模式渲染', 'render mode', 'info');
      return (await renderHtml2Image(this.ctx, this.config, this.$http, htmlContent, arg)).toString();
    }

    // File 或 assets 模式
    if (imageMode === 'File' || imageMode === 'assets') {
      if (!this.ctx.puppeteer) {
        debug(this.config, '未安装 puppeteer 插件，跳过图片渲染', 'puppeteer error', 'error');
        return htmlContent;
      }

      try {
        debug(this.config, `使用 ${imageMode} 模式渲染`, 'render mode', 'info');
        const processedHtml = await preprocessHtmlImages(this.ctx, this.config, this.$http, htmlContent, arg);

        let msg: string;
        if ((this.config.template?.deviceScaleFactor ?? 1) !== 1) {
          msg = (await renderHtml2Image(this.ctx, this.config, this.$http, processedHtml, arg)).toString();
        } else {
          msg = await this.ctx.puppeteer.render(processedHtml);
        }

        msg = await puppeteerToFile(this.ctx, this.config, msg);
        debug(this.config, 'puppeteer 渲染完成', 'render success', 'info');
        return msg;
      } catch (error) {
        debug(this.config, `puppeteer render 失败: ${error}`, 'puppeteer error', 'error');
        return htmlContent;
      }
    }

    // 未知模式，回退到 HTML
    debug(this.config, `未知的 imageMode: ${imageMode}，回退到 HTML`, 'render warning', 'error');
    return htmlContent;
  }
}
