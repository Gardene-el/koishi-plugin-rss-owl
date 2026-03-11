/**
 * 观测辅助日志包装层。
 *
 * 注意：当前插件主流程日志入口是 `src/utils/logger.ts` 中的
 * `debug / debugInfo / debugError / createDebugWithContext`。
 * 这里保留为可选的观测与兼容包装，不应作为新业务代码的首选入口。
 */

import { Config } from '../types'
import { debug as coreDebug, shouldLog as shouldCoreLog } from './logger'

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DISABLE = 'disable',
  ERROR = 'error',
  INFO = 'info',
  DETAILS = 'details'
}

/**
 * 日志条目接口
 */
export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: Record<string, any>
  error?: {
    name: string
    message: string
    stack?: string
  }
  performance?: {
    duration?: number
    memory?: number
  }
  context?: {
    platform?: string
    guildId?: string
    userId?: string
    rssId?: string
    url?: string
  }
}

/**
 * 性能计时器
 */
export class PerformanceTimer {
  private startTime: number
  private startMemory: number

  constructor() {
    this.startTime = Date.now()
    this.startMemory = process.memoryUsage().heapUsed / 1024 / 1024
  }

  /**
   * 获取耗时（毫秒）
   */
  getDuration(): number {
    return Date.now() - this.startTime
  }

  /**
   * 获取内存使用（MB）
   */
  getMemoryUsage(): number {
    const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024
    return currentMemory - this.startMemory
  }

  /**
   * 获取性能数据
   */
  getMetrics(): { duration: number; memory: number } {
    return {
      duration: this.getDuration(),
      memory: this.getMemoryUsage()
    }
  }
}

/**
 * 结构化日志记录器类。
 * 内部仍然回落到主日志入口，避免形成第二条日志主线。
 */
export class StructuredLogger {
  private config: Config
  private enableJsonOutput: boolean

  constructor(config: Config, enableJsonOutput = false) {
    this.config = config
    this.enableJsonOutput = enableJsonOutput
  }

  /**
   * 判断是否应该记录日志
   */
  private shouldLog(level: LogLevel): boolean {
    return shouldCoreLog(this.config, level)
  }

  /**
   * 格式化日志条目
   */
  private formatEntry(entry: LogEntry): string {
    if (this.enableJsonOutput) {
      return JSON.stringify(entry)
    }

    const header = [
      `[${entry.timestamp}]`,
      `[${entry.level.toUpperCase()}]`,
      entry.module ? `[${entry.module}]` : '',
      entry.message
    ].filter(Boolean).join(' ')

    const lines = [header]

    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = Object.entries(entry.context)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
      lines.push(`↳ context: ${contextStr}`)
    }

    if (entry.data && Object.keys(entry.data).length > 0) {
      const dataStr = Object.entries(entry.data)
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join(', ')
      lines.push(`↳ data: ${dataStr}`)
    }

    if (entry.performance) {
      const perfParts = []
      if (entry.performance.duration) {
        perfParts.push(`duration=${entry.performance.duration}ms`)
      }
      if (entry.performance.memory) {
        perfParts.push(`memory=${entry.performance.memory.toFixed(2)}MB`)
      }
      if (perfParts.length > 0) {
        lines.push(`↳ performance: ${perfParts.join(', ')}`)
      }
    }

    if (entry.error) {
      lines.push(`↳ error: ${entry.error.name}: ${entry.error.message}`)
    }

    return lines.join('\n')
  }

  /**
   * 记录日志
   */
  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return
    }

    const formattedMessage = this.formatEntry(entry)
    coreDebug(this.config, formattedMessage, '', entry.level)
  }

  /**
   * 记录普通信息
   */
  info(message: string, module: string, data?: Record<string, any>, context?: LogEntry['context']): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      module,
      message,
      data,
      context
    })
  }

  /**
   * 记录详细信息
   */
  details(message: string, module: string, data?: Record<string, any>, context?: LogEntry['context']): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: LogLevel.DETAILS,
      module,
      message,
      data,
      context
    })
  }

  /**
   * 记录错误
   */
  error(message: string, module: string, error?: Error, context?: LogEntry['context']): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      module,
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined,
      context
    })
  }

  /**
   * 记录性能数据
   */
  performance(
    message: string,
    module: string,
    timer: PerformanceTimer,
    context?: LogEntry['context']
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      module,
      message,
      performance: timer.getMetrics(),
      context
    })
  }

  /**
   * 创建性能计时器
   */
  createTimer(): PerformanceTimer {
    return new PerformanceTimer()
  }
}

// 全局结构化日志实例
let globalStructuredLogger: StructuredLogger | null = null

/**
 * 初始化全局结构化日志
 */
export function initStructuredLogger(config: Config, enableJsonOutput = false): void {
  globalStructuredLogger = new StructuredLogger(config, enableJsonOutput)
}

/**
 * 获取全局结构化日志实例
 */
export function getStructuredLogger(): StructuredLogger | null {
  return globalStructuredLogger
}

/**
 * 便捷方法：记录信息
 */
export function logInfo(
  message: string,
  module: string,
  data?: Record<string, any>,
  context?: LogEntry['context']
): void {
  if (globalStructuredLogger) {
    globalStructuredLogger.info(message, module, data, context)
  }
}

/**
 * 便捷方法：记录详细信息
 */
export function logDetails(
  message: string,
  module: string,
  data?: Record<string, any>,
  context?: LogEntry['context']
): void {
  if (globalStructuredLogger) {
    globalStructuredLogger.details(message, module, data, context)
  }
}

/**
 * 便捷方法：记录错误
 */
export function logError(
  message: string,
  module: string,
  error?: Error,
  context?: LogEntry['context']
): void {
  if (globalStructuredLogger) {
    globalStructuredLogger.error(message, module, error, context)
  }
}

/**
 * 便捷方法：创建计时器
 */
export function createTimer(): PerformanceTimer {
  return new PerformanceTimer()
}

/**
 * 便捷方法：记录性能
 */
export function logPerformance(
  message: string,
  module: string,
  timer: PerformanceTimer,
  context?: LogEntry['context']
): void {
  if (globalStructuredLogger) {
    globalStructuredLogger.performance(message, module, timer, context)
  }
}
