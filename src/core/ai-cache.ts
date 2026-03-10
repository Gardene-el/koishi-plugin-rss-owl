import * as crypto from 'crypto'

import { Config } from '../types'
import { debug } from '../utils/logger'

interface CacheEntry {
  summary: string
  timestamp: number
  lastAccess: number
}

export class AiSummaryCache {
  private cache: Map<string, CacheEntry> = new Map()
  private ttl: number
  private maxSize: number
  private accessOrder: string[] = []

  constructor(ttl: number = 24 * 60 * 60 * 1000, maxSize: number = 1000) {
    this.ttl = ttl
    this.maxSize = maxSize
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift()
      if (oldestKey && this.cache.has(oldestKey)) {
        this.cache.delete(oldestKey)
      }

      if (this.accessOrder.length === 0 && this.cache.size >= this.maxSize) {
        const randomKey = this.cache.keys().next().value
        if (randomKey) {
          this.cache.delete(randomKey)
        }
        break
      }
    }
  }

  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    this.accessOrder.push(key)
  }

  private removeAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
  }

  private generateKey(title: string, content: string): string {
    return crypto
      .createHash('sha256')
      .update(`${title}|||${content}`)
      .digest('hex')
  }

  get(title: string, content: string): string | null {
    const key = this.generateKey(title, content)
    const entry = this.cache.get(key)

    if (!entry) return null

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      this.removeAccessOrder(key)
      return null
    }

    this.updateAccessOrder(key)
    entry.lastAccess = Date.now()
    return entry.summary
  }

  set(title: string, content: string, summary: string): void {
    const key = this.generateKey(title, content)

    if (this.cache.has(key)) {
      this.updateAccessOrder(key)
      const entry = this.cache.get(key)!
      entry.summary = summary
      entry.timestamp = Date.now()
      entry.lastAccess = Date.now()
      return
    }

    this.evictIfNeeded()

    this.cache.set(key, {
      summary,
      timestamp: Date.now(),
      lastAccess: Date.now()
    })
    this.accessOrder.push(key)
  }

  cleanExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key)
        this.removeAccessOrder(key)
      }
    }
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder = []
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    }
  }
}

let globalCache: AiSummaryCache | null = null

export function initAiCache(ttl?: number, maxSize?: number): void {
  if (!globalCache) {
    const defaultMaxSize = 1000
    globalCache = new AiSummaryCache(ttl, maxSize || defaultMaxSize)
    debug(
      { debug: 'info' } as Config,
      `AI 摘要缓存已初始化 (TTL: ${ttl || 24 * 60 * 60 * 1000}ms, MaxSize: ${maxSize || defaultMaxSize})`,
      'AI-Cache',
      'info'
    )
  }
}

export function getOrInitAiCache(ttl?: number, maxSize?: number): AiSummaryCache {
  if (!globalCache) {
    initAiCache(ttl, maxSize)
  }
  return globalCache!
}

export function cleanExpiredCache(): void {
  if (globalCache) {
    globalCache.cleanExpired()
  }
}

export function clearAiCache(): void {
  if (globalCache) {
    globalCache.clear()
  }
}

export function getAiCacheStats(): { size: number; keys: string[] } | null {
  if (globalCache) {
    return globalCache.getStats()
  }
  return null
}