import DOMPurify from 'isomorphic-dompurify'
import { Config } from '../types'
import * as cheerio from 'cheerio'

/**
 * 允许的 HTML 标签列表
 */
const ALLOWED_TAGS = [
  // 基础标签
  'p', 'br', 'hr',
  // 文本格式化
  'b', 'i', 'u', 'strong', 'em', 's', 'strike', 'del', 'sub', 'sup',
  // 标题
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // 链接和媒体
  'a', 'img', 'video', 'audio', 'source', 'track',
  // 列表
  'ul', 'ol', 'li',
  // 容器
  'div', 'span', 'section', 'article', 'header', 'footer', 'nav', 'main',
  'aside', 'figure', 'figcaption',
  // 引用和代码
  'blockquote', 'pre', 'code', 'details', 'summary',
  // 表格
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  // 语义化标签
  'time', 'mark'
]

/**
 * 允许的 HTML 属性列表
 */
const ALLOWED_ATTR = [
  // 全局属性
  'class', 'style', 'id', 'title', 'lang', 'dir',
  // 链接属性
  'href', 'target', 'rel',
  // 媒体属性
  'src', 'alt', 'width', 'height', 'poster', 'controls', 'autoplay', 'loop', 'muted', 'preload',
  // 表格属性
  'colspan', 'rowspan',
  // time 标签属性
  'datetime',
  // details 标签属性
  'open'
]

/**
 * 配置 DOMPurify
 */
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,      // 禁止 data-* 属性
  ALLOWED_URI_REGEXP: /^(?:(?:https?):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  ADD_ATTR: ['target'],         // 允许 target 属性
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button', 'object', 'embed'],
  FORBID_ATTR: [
    // 事件处理器
    'onclick', 'oncontextmenu', 'ondblclick', 'onmousedown', 'onmouseenter',
    'onmouseleave', 'onmousemove', 'onmouseover', 'onmouseout', 'onmouseup',
    'onkeydown', 'onkeypress', 'onkeyup', 'onabort', 'onbeforeunload',
    'onerror', 'onhashchange', 'onload', 'onpageshow', 'onpagehide',
    'onresize', 'onscroll', 'onunload', 'onblur', 'onchange', 'onfocus',
    'oninput', 'oninvalid', 'onreset', 'onsearch', 'onselect', 'onsubmit',
    // JavaScript URL
    'javascript:', 'vbscript:', 'data:',
    // expr 表达式
    'expr', 'xpression'
  ]
}

/**
 * 清理 HTML 内容，移除潜在恶意代码
 *
 * @param html - 要清理的 HTML 字符串
 * @param config - 可选的额外配置
 * @returns 清理后的 HTML 字符串
 */
export function sanitizeHtml(html: string, config?: Record<string, unknown>): string {
  if (!html) return ''

  // 合并配置
  const mergeConfig = {
    ...DOMPURIFY_CONFIG,
    ...config
  }

  return DOMPurify.sanitize(html, mergeConfig)
}

/**
 * 清理并返回纯文本（用于需要提取文本的场景）
 *
 * @param html - 要清理的 HTML 字符串
 * @returns 清理后的纯文本
 */
export function sanitizeToText(html: string): string {
  if (!html) return ''

  // 先清理 HTML
  const cleanHtml = sanitizeHtml(html)

  // 使用 cheerio 提取纯文本
  const $ = cheerio.load(cleanHtml)
  return $.text()
}

/**
 * 清理 HTML 中的图片 URL
 *
 * @param html - 包含图片的 HTML 字符串
 * @returns 清理后的 HTML（图片 URL 已验证）
 */
export function sanitizeImageUrls(html: string): string {
  if (!html) return ''

  // 使用 DOMPurify 清理，但只允许 img 标签
  const imgOnlyConfig = {
    ...DOMPURIFY_CONFIG,
    ALLOWED_TAGS: ['img'],
    ALLOWED_ATTR: ['src', 'alt', 'width', 'height', 'style', 'class', 'title']
  }

  return DOMPurify.sanitize(html, imgOnlyConfig)
}

/**
 * 清理链接（a 标签）
 *
 * @param html - 包含链接的 HTML 字符串
 * @returns 清理后的 HTML（链接已安全化）
 */
export function sanitizeLinks(html: string): string {
  if (!html) return ''

  // 使用 DOMPurify 清理，但只允许 a 标签
  const linkOnlyConfig = {
    ...DOMPURIFY_CONFIG,
    ALLOWED_TAGS: ['a'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'title']
  }

  // 添加链接安全化：添加 rel="noopener noreferrer"
  let cleanHtml = DOMPurify.sanitize(html, linkOnlyConfig)

  // 添加安全属性
  cleanHtml = cleanHtml.replace(
    /<a(\s+href=)/gi,
    '<a target="_blank" rel="noopener noreferrer"$1'
  )

  return cleanHtml
}

/**
 * 创建带有 HTML 清理功能的模板内容处理函数
 *
 * @param config - 配置对象
 * @returns 清理函数
 */
export function createSanitizer(config: Config) {
  const enabled = config.security?.sanitizeHtml !== false

  return {
    /**
     * 清理 HTML 内容
     */
    sanitize: (html: string): string => {
      if (!enabled) return html
      return sanitizeHtml(html)
    },

    /**
     * 清理并返回纯文本
     */
    sanitizeToText: (html: string): string => {
      if (!enabled) return html
      return sanitizeToText(html)
    },

    /**
     * 清理图片
     */
    sanitizeImages: (html: string): string => {
      if (!enabled) return html
      return sanitizeImageUrls(html)
    },

    /**
     * 清理链接
     */
    sanitizeLinks: (html: string): string => {
      if (!enabled) return html
      return sanitizeLinks(html)
    },

    /**
     * 检查是否启用清理
     */
    isEnabled: () => enabled
  }
}
