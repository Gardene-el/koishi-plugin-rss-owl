import { Logger } from 'koishi'
import { Config, debugLevel } from '../types'

const logger = new Logger('rss-owl')

export type DebugLogType = "disable" | "error" | "info" | "details"

export function shouldLog(config: Config, type: DebugLogType): boolean {
  const typeLevel = debugLevel.findIndex(i => i === type)
  if (typeLevel < 1) return false

  const configLevel = debugLevel.findIndex(i => i === config.debug)
  if (configLevel < 0) return false

  return typeLevel <= configLevel
}

/**
 * 敏感信息模式定义
 */
const SENSITIVE_PATTERNS = [
  // API Key 模式
  { pattern: /api[_-]?key["']?\s*[:=]\s*["']?([^"'&\s,}]+)/gi, replacement: 'api_key=***' },
  // Bearer Token
  { pattern: /Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/gi, replacement: 'Bearer ***' },
  // Basic Auth
  { pattern: /Basic\s+([A-Za-z0-9+/=]+)/gi, replacement: 'Basic ***' },
  // 代理认证
  { pattern: /([a-zA-Z]+):\/\/([^:]+):([^@]+)@/gi, replacement: '$1://$2:***@' },
  // 密码字段
  { pattern: /["']?password["']?\s*[:=]\s*["']?([^"'&\s,}]+)/gi, replacement: 'password=***' },
  // 密钥字段
  { pattern: /["']?secret["']?\s*[:=]\s*["']?([^"'&\s,}]+)/gi, replacement: 'secret=***' },
  { pattern: /["']?token["']?\s*[:=]\s*["']?([^"'&\s,}]+)/gi, replacement: 'token=***' },
  // AWS Access Key
  { pattern: /(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, replacement: '***' },
  // GitHub Token
  { pattern: /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g, replacement: '***' },
  // JWT Token (更精确的匹配)
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: '***' },
]

/**
 * 脱敏日志消息，移除敏感信息
 *
 * @param message - 原始消息（字符串或对象）
 * @returns 脱敏后的消息
 */
function sanitizeLogMessage(message: any): any {
  if (typeof message === 'string') {
    let sanitized = message
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement)
    }
    return sanitized
  }

  if (message === null || message === undefined) {
    return message
  }

  if (message instanceof Error) {
    const sanitizedError = new Error(sanitizeLogMessage(message.message))
    sanitizedError.name = message.name
    return sanitizedError
  }

  // 如果是对象，深度脱敏
  if (typeof message === 'object') {
    try {
      // 先序列化再脱敏，然后反序列化
      const jsonStr = JSON.stringify(message)
      let sanitized = jsonStr

      for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
        sanitized = sanitized.replace(pattern, replacement)
      }

      return JSON.parse(sanitized)
    } catch {
      // 如果序列化失败，返回原始对象的脱敏版本
      return sanitizeObject(message)
    }
  }

  return message
}

/**
 * 递归脱敏对象中的敏感字段
 */
function sanitizeObject(obj: any, depth = 0): any {
  // 防止无限递归
  if (depth > 5 || obj === null || obj === undefined) {
    return obj
  }

  // 敏感字段列表
  const sensitiveFields = new Set([
    'password', 'passwd', 'secret', 'token', 'apiKey', 'api_key',
    'apikey', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
    'auth', 'authorization', 'credential', 'privateKey', 'private_key',
    'sessionId', 'session_id', 'sessionid', 'cookie', 'x-api-key',
    'x-api-key', 'bearer', 'basic'
  ])

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1))
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase()
      if (sensitiveFields.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('token')) {
        result[key] = '***'
      } else if (typeof value === 'object') {
        result[key] = sanitizeObject(value, depth + 1)
      } else if (typeof value === 'string') {
        // 检查字符串值是否包含可能的 token
        if (value.length > 30 && /[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/.test(value)) {
          result[key] = '***'
        } else {
          result[key] = value
        }
      } else {
        result[key] = value
      }
    }
    return result
  }

  return obj
}

/**
 * 结构化日志接口
 */
interface StructuredLogEntry {
  timestamp?: string
  level?: string
  module?: string
  message: string
  context?: Record<string, any>
}

function emitLog(type: DebugLogType, content: string): void {
  if (type === 'error') {
    logger.error(content)
    return
  }

  logger.info(content)
}

function filterContextFields(
  context: Record<string, any>,
  contextFields?: string[]
): Record<string, any> {
  if (!contextFields?.length) {
    return context
  }

  const filteredContext: Record<string, any> = {}
  contextFields.forEach((field) => {
    if (context[field] !== undefined) {
      filteredContext[field] = context[field]
    }
  })
  return filteredContext
}

function formatContextValue(value: any): string {
  if (value instanceof Error) {
    return value.message || value.name
  }

  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

function formatTextLog(
  message: string,
  name: string,
  context: Record<string, any> | undefined,
  loggingConfig: Config['logging']
): string {
  const parts: string[] = []
  if (loggingConfig?.includeModule !== false && name) {
    parts.push(`[${name}]`)
  }
  parts.push(message)

  const textOutput = parts.filter(Boolean).join(' ').trim()
  if (!context || Object.keys(context).length === 0) {
    return textOutput
  }

  const filteredContext = filterContextFields(context, loggingConfig?.contextFields)
  if (Object.keys(filteredContext).length === 0) {
    return textOutput
  }

  const contextStr = Object.entries(filteredContext)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${formatContextValue(value)}`)
    .join(', ')

  return `${textOutput}\n↳ ${contextStr}`
}

/**
 * 增强的调试日志函数
 *
 * @param config - 配置对象
 * @param message - 日志消息（字符串或对象）
 * @param name - 模块名称
 * @param type - 日志级别
 * @param context - 额外的上下文信息
 */
export function debug(
  config: Config,
  message: any,
  name = '',
  type: DebugLogType = 'details',
  context?: Record<string, any>
) {
  if (!shouldLog(config, type)) return

  // 检查是否启用日志脱敏（默认启用）
  const sanitizeEnabled = config.logging?.sanitizeLogs !== false
  if (sanitizeEnabled) {
    message = sanitizeLogMessage(message)
    if (context) {
      context = sanitizeObject(context)
    }
  }

  // 获取日志配置
  const loggingConfig = config.logging || {}

  // 格式化消息内容
  let formattedMessage: string
  if (typeof message === 'string') {
    formattedMessage = message
  } else if (message instanceof Error) {
    formattedMessage = message.message || String(message)
  } else if (typeof message === 'function') {
    formattedMessage = String(message)
  } else if (message === null || message === undefined) {
    formattedMessage = String(message)
  } else {
    try {
      // 对于复杂对象，使用 JSON.stringify 并处理循环引用
      formattedMessage = JSON.stringify(message, (_, value) => {
        if (typeof value === 'function') return '[Function]'
        if (value instanceof Error) return value.message
        return value
      }, 2)
    } catch {
      formattedMessage = String(message)
    }
  }

  // 如果启用结构化日志，输出 JSON 格式
  if (loggingConfig.structured) {
    const logEntry: StructuredLogEntry = {
      message: formattedMessage
    }

    // 添加时间戳
    if (loggingConfig.includeTimestamp !== false) {
      logEntry.timestamp = new Date().toISOString()
    }

    // 添加日志级别
    if (loggingConfig.includeLevel !== false) {
      logEntry.level = type
    }

    // 添加模块名
    if (loggingConfig.includeModule !== false && name) {
      logEntry.module = name
    }

    // 添加上下文信息
    if (loggingConfig.includeContext && context) {
      const filteredContext = filterContextFields(context, loggingConfig.contextFields)
      if (Object.keys(filteredContext).length > 0) {
        logEntry.context = filteredContext
      }
    }

    // 输出结构化日志
    emitLog(type, JSON.stringify(logEntry))
  } else {
    emitLog(type, formatTextLog(formattedMessage, name, context, loggingConfig))
  }
}

/**
 * 便捷函数：记录错误日志
 */
export function debugError(
  config: Config,
  message: any,
  name = '',
  context?: Record<string, any>
) {
  return debug(config, message, name, 'error', context)
}

/**
 * 便捷函数：记录信息日志
 */
export function debugInfo(
  config: Config,
  message: any,
  name = '',
  context?: Record<string, any>
) {
  return debug(config, message, name, 'info', context)
}

/**
 * 创建带有固定上下文的调试函数
 *
 * @param config - 配置对象
 * @param fixedContext - 固定的上下文信息
 * @returns 带有固定上下文的 debug 函数
 *
 * @example
 * const feedDebug = createDebugWithContext(config, { guildId: '123', platform: 'onebot' })
 * feedDebug('Processing feed', 'feeder', 'info')
 * // 输出会自动包含 guildId 和 platform
 */
export function createDebugWithContext(
  config: Config,
  fixedContext: Record<string, any>
) {
  return (
    message: any,
    name = '',
    type: DebugLogType = 'details',
    additionalContext?: Record<string, any>
  ) => {
    const mergedContext = {
      ...fixedContext,
      ...additionalContext
    }
    return debug(config, message, name, type, mergedContext)
  }
}

export { logger }
