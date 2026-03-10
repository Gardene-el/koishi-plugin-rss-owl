/**
 * 结构化日志系统
 * 提供统一的日志格式，支持 JSON 输出和性能监控
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
 * 结构化日志记录器类
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

    // 文本格式
    const parts = [
      `[${entry.timestamp}]`,
      `[${entry.level.toUpperCase()}]`,
      entry.module ? `[${entry.module}]` : '',
      entry.message
    ].filter(Boolean).join(' ')

    // 添加性能数据
    if (entry.performance) {
      const perfParts = []
      if (entry.performance.duration) {
        perfParts.push(`⏱️ ${entry.performance.duration}ms`)
      }
      if (entry.performance.memory) {
        perfParts.push(`💾 ${entry.performance.memory.toFixed(2)}MB`)
      }
      if (perfParts.length > 0) {
        return parts + '\n' + perfParts.join(' | ')
      }
    }

    // 添加上下文数据
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = Object.entries(entry.context)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
      return parts + `\n📍 ${contextStr}`
    }

    // 添加错误信息
    if (entry.error) {
      return parts + `\n❌ ${entry.error.name}: ${entry.error.message}`
    }

    return parts
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
