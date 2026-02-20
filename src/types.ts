import { Context } from 'koishi'

// assets 服务类型声明
declare module 'koishi' {
  interface Context {
    assets?: {
      upload(dataUrl: string, filename: string): Promise<string>
    }
  }
}

declare module 'koishi' {
  interface rssOwl {
    id: string | number
    url: string
    platform: string
    guildId: string
    author: string
    rssId: number
    arg: rssArg,
    title: string
    lastPubDate: Date
  }

  interface rss_message_cache {
    id: number
    rssId: string
    guildId: string
    platform: string
    title: string
    content: string
    link: string
    pubDate: Date
    imageUrl: string
    videoUrl: string
    createdAt: Date
  }
}

export interface Config {
  basic?: BasicConfig
  template?: TemplateConfig
  net?: NetConfig
  msg?: MsgConfig
  ai?: AiConfig
  search?: SearchConfig
  cache?: CacheConfig
  debug?: "disable"|"error"|"info"|"details"
  logging?: LoggingConfig
}

export const debugLevel = ["disable","error","info","details"]

export interface BasicConfig {
  usePoster: boolean;
  margeVideo: boolean;
  defaultTemplate?: 'auto' | 'content' | 'only text' | 'only media' | 'only image' | 'only video' | 'proto' | 'default' | 'only description' | 'custom' | 'link'
  timeout?: number
  refresh?: number
  merge?: '不合并' | '有多条更新时合并' | '一直合并'
  maxRssItem?: number
  firstLoad?: boolean
  urlDeduplication?: boolean
  resendUpdataContent: 'disable'|'latest'|'all'
  imageMode?: 'base64' | 'File' | 'assets'
  videoMode?: 'filter'|'href'|'base64' | 'File' | 'assets'
  autoSplitImage?: boolean
  cacheDir?: string
  replaceDir?: string
  maxImageSize?: number  // 图片最大文件大小（MB）
  maxVideoSize?: number  // 视频最大文件大小（MB）

  authority:number
  advancedAuthority:number
}

export interface TemplateConfig {
  customRemark: string;
  bodyWidth?: number
  bodyPadding?: number
  bodyFontSize?: number
  deviceScaleFactor?: 0.5 | 1 | 1.5 | 2 | 3
  content?: string
  custom?: string
  customTemplate?: any[]
}

export interface NetConfig {
  userAgent?: string
  proxyAgent?: proxyAgent
}

export interface MsgConfig {
  censor?: boolean
  keywordFilter?: Array<string>
  keywordBlock?: Array<string>
  blockString?:string
  rssHubUrl?:string
}

export interface AiConfig {
  enabled?: boolean
  baseUrl?: string
  apiKey?: string
  model?: string
  placement?: 'top' | 'bottom'
  separator?: string
  prompt?: string
  maxInputLength?: number
  timeout?: number
}

export interface proxyAgent {
  enabled?: boolean
  autoUseProxy?: boolean
  protocol?: string
  host?: string,
  port?: number
  auth?: auth
}

export interface auth {
  enabled: boolean
  username: string
  password: string
}

export interface rss {
  url: string
  id: string | number
  arg: rssArg,
  title: string
  author: string
  lastPubDate: Date
}

export interface rssArg {
  template?: 'auto' | 'content' | 'only text' | 'only media' | 'only image' | 'only video' | 'proto' | 'default' | 'only description' | 'custom' | 'link'
  content?: string

  forceLength?: number
  timeout?: number
  interval?: number
  reverse?: boolean

  firstLoad?: boolean
  merge?: boolean
  maxRssItem?: number
  proxyAgent?: proxyAgent
  bodyWidth?: number
  bodyPadding?: number
  bodyFontSize?: number
  filter?: Array<string>
  block?: Array<string>


  split?:number

  nextUpdataTime?: number

  // HTML 监控相关字段
  type?: 'rss' | 'html'
  selector?: string
  textOnly?: boolean
  mode?: 'static' | 'puppeteer'
  waitFor?: number
  waitSelector?: string
}

export interface CacheConfig {
  enabled?: boolean
  maxSize?: number  // 最大缓存条数，默认 100
}

export interface LoggingConfig {
  structured?: boolean  // 启用结构化日志（JSON格式）
  includeTimestamp?: boolean  // 包含时间戳
  includeLevel?: boolean  // 包含日志级别
  includeModule?: boolean  // 包含模块名
  includeContext?: boolean  // 包含额外上下文信息
  contextFields?: string[]  // 要包含的上下文字段
}

/**
 * 联网搜索配置
 */
export interface SearchConfig {
  enabled?: boolean  // 是否启用联网搜索
  engine?: 'tavily' | 'searxng' | 'volcengine' | 'auto'  // 搜索引擎选择，auto 表示自动选择
  maxResults?: number  // 最大结果数
  enginePriority?: Array<'tavily' | 'searxng' | 'volcengine'>  // 引擎优先级（当 engine 为 auto 时使用）
  tavily?: TavilyConfig  // Tavily 配置
  searxng?: SearxngConfig  // SearXNG 配置
  volcengine?: VolcengineConfig  // 火山引擎配置
}

/**
 * Tavily 搜索配置
 */
export interface TavilyConfig {
  apiKey?: string  // Tavily API Key
  searchDepth?: 'basic' | 'advanced'  // 搜索深度
  includeAnswer?: boolean  // 是否包含 AI 生成的答案
}

/**
 * SearXNG 搜索配置
 */
export interface SearxngConfig {
  instanceUrl?: string  // SearXNG 实例 URL
  language?: string  // 搜索语言
  categories?: Array<'general' | 'news' | 'images' | 'videos'>  // 搜索类别
}

/**
 * 火山引擎搜索配置
 */
export interface VolcengineConfig {
  apiKey?: string  // 火山引擎 API Key（使用 AI 配置中的 baseUrl 和 model）
  models?: string[]  // 模型列表，支持轮询（默认使用 AI 配置中的 model）
  useAiModel?: boolean  // 是否使用 AI 配置中的 model（默认 true）
}
