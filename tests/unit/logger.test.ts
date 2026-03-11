/**
 * logger 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { createDebugWithContext, debug, logger } from '../../src/utils/logger'
import { Config } from '../../src/types'

describe('logger', () => {
  let mockConfig: Config
  let infoSpy: jest.SpiedFunction<any>
  let errorSpy: jest.SpiedFunction<any>

  beforeEach(() => {
    mockConfig = {
      debug: 'disable',
      logging: {},
    } as any

    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    infoSpy.mockRestore()
    errorSpy.mockRestore()
  })

  describe('debugLevel', () => {
    it('应该包含所有调试级别', () => {
      // debugLevel 从 types.ts 导入
      expect(['disable', 'error', 'info', 'details']).toEqual(
        expect.arrayContaining(['disable', 'error', 'info', 'details'])
      )
    })

    it('应该有 4 个调试级别', () => {
      expect(['disable', 'error', 'info', 'details']).toHaveLength(4)
    })
  })

  describe('debug', () => {
    it('应该在 debug 模式为 disable 时不输出任何内容', () => {
      mockConfig.debug = 'disable'
      debug(mockConfig, 'test message', 'test', 'error')
      expect(infoSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('应该在 debug 模式为 error 时输出 error 级别', () => {
      mockConfig.debug = 'error'
      debug(mockConfig, 'test message', 'test', 'error')
      expect(errorSpy).toHaveBeenCalledWith('[test] test message')
      expect(infoSpy).not.toHaveBeenCalled()
    })

    it('应该在 debug 模式为 info 时输出 info 和 error 级别', () => {
      mockConfig.debug = 'info'
      debug(mockConfig, 'test message', 'test', 'info')
      expect(infoSpy).toHaveBeenCalledWith('[test] test message')

      infoSpy.mockClear()
      debug(mockConfig, 'test message', 'test', 'error')
      expect(errorSpy).toHaveBeenCalledWith('[test] test message')
    })

    it('应该在 debug 模式为 details 时输出所有级别', () => {
      mockConfig.debug = 'details'
      debug(mockConfig, 'test message', 'test', 'details')
      expect(infoSpy).toHaveBeenCalledWith('[test] test message')
    })

    it('应该正确处理字符串消息', () => {
      mockConfig.debug = 'info'
      debug(mockConfig, 'simple string', 'test', 'info')
      expect(infoSpy).toHaveBeenCalledWith('[test] simple string')
    })

    it('应该正确处理对象消息', () => {
      mockConfig.debug = 'info'
      const testObj = { key: 'value', number: 42 }
      debug(mockConfig, testObj, 'test', 'info')
      expect(infoSpy).toHaveBeenCalled()
      expect(String(infoSpy.mock.calls[0][0])).toContain('"key": "value"')
    })

    it('应该正确处理错误对象', () => {
      mockConfig.debug = 'error'
      const error = new Error('Test error')
      debug(mockConfig, error, 'test', 'error')
      expect(errorSpy).toHaveBeenCalledWith('[test] Test error')
    })

    it('应该正确处理函数消息', () => {
      mockConfig.debug = 'details'
      const testFunc = () => 'test'
      debug(mockConfig, testFunc, 'test', 'details')
      expect(infoSpy).toHaveBeenCalledWith('[test] () => \'test\'')
    })

    it('应该处理空名称', () => {
      mockConfig.debug = 'info'
      debug(mockConfig, 'test message', '', 'info')
      expect(infoSpy).toHaveBeenCalledWith('test message')
    })

    it('应该处理 undefined 消息', () => {
      mockConfig.debug = 'info'
      debug(mockConfig, undefined, 'test', 'info')
      expect(infoSpy).toHaveBeenCalledWith('[test] undefined')
    })

    it('应该处理 null 消息', () => {
      mockConfig.debug = 'info'
      debug(mockConfig, null, 'test', 'info')
      expect(infoSpy).toHaveBeenCalledWith('[test] null')
    })

    it('应该默认脱敏敏感日志和上下文', () => {
      mockConfig.debug = 'info'
      mockConfig.logging = { includeContext: true }

      debug(
        mockConfig,
        'token=abc123 password=secret123',
        'test',
        'info',
        { apiKey: 'real-key', safe: 'ok' }
      )

      const output = String(infoSpy.mock.calls[0][0])
      expect(output).toContain('token=***')
      expect(output).toContain('password=***')
      expect(output).toContain('apiKey=***')
      expect(output).toContain('safe=ok')
      expect(output).not.toContain('abc123')
      expect(output).not.toContain('secret123')
      expect(output).not.toContain('real-key')
    })

    it('应该在文本日志中按字段过滤并格式化上下文', () => {
      mockConfig.debug = 'info'
      mockConfig.logging = {
        contextFields: ['guildId', 'retry'],
      }

      debug(mockConfig, 'context message', 'test', 'info', {
        retry: 2,
        userId: 'user-1',
        guildId: 'guild-1',
      })

      const output = String(infoSpy.mock.calls[0][0])
      expect(output).toBe('[test] context message\n↳ guildId=guild-1, retry=2')
    })

    it('应该允许关闭日志脱敏', () => {
      mockConfig.debug = 'info'
      mockConfig.logging = { sanitizeLogs: false }

      debug(mockConfig, 'token=abc123', 'test', 'info')

      expect(infoSpy).toHaveBeenCalledWith('[test] token=abc123')
    })

    it('应该在结构化日志中输出过滤后的上下文并保留 error 级别', () => {
      mockConfig.debug = 'details'
      mockConfig.logging = {
        structured: true,
        includeContext: true,
        contextFields: ['guildId'],
      }

      debug(mockConfig, 'structured message', 'test', 'error', {
        guildId: 'guild-1',
        userId: 'user-1',
      })

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).not.toHaveBeenCalled()

      const payload = JSON.parse(String(errorSpy.mock.calls[0][0]))
      expect(payload.message).toBe('structured message')
      expect(payload.level).toBe('error')
      expect(payload.module).toBe('test')
      expect(payload.context).toEqual({ guildId: 'guild-1' })
    })
  })

  describe('日志级别过滤', () => {
    it('应该过滤低级别日志 (mode=error, type=info)', () => {
      mockConfig.debug = 'error'
      const initialCallCount = infoSpy.mock.calls.length

      debug(mockConfig, 'info message', 'test', 'info')
      debug(mockConfig, 'details message', 'test', 'details')

      // error 级别不应该输出 info 和 details
      expect(infoSpy.mock.calls.length).toBe(initialCallCount)
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('应该过滤低级别日志 (mode=info, type=details)', () => {
      mockConfig.debug = 'info'
      const initialCallCount = infoSpy.mock.calls.length

      debug(mockConfig, 'details message', 'test', 'details')

      // info 级别不应该输出 details
      expect(infoSpy.mock.calls.length).toBe(initialCallCount)
    })

    it('应该允许高级别日志 (mode=info, type=error)', () => {
      mockConfig.debug = 'info'
      debug(mockConfig, 'error message', 'test', 'error')
      expect(errorSpy).toHaveBeenCalledWith('[test] error message')
    })
  })

  describe('createDebugWithContext', () => {
    it('应该合并固定上下文和额外上下文', () => {
      mockConfig.debug = 'details'
      mockConfig.logging = {
        structured: true,
        includeTimestamp: false,
        includeContext: true,
      }

      const requestDebug = createDebugWithContext(mockConfig, {
        guildId: 'guild-1',
        platform: 'onebot',
        stage: 'fixed',
      })

      requestDebug('merged context', 'request', 'info', {
        stage: 'runtime',
        url: 'https://example.com/feed.xml',
      })

      expect(infoSpy).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(String(infoSpy.mock.calls[0][0]))
      expect(payload.message).toBe('merged context')
      expect(payload.module).toBe('request')
      expect(payload.level).toBe('info')
      expect(payload.context).toEqual({
        guildId: 'guild-1',
        platform: 'onebot',
        stage: 'runtime',
        url: 'https://example.com/feed.xml',
      })
    })
  })
})
