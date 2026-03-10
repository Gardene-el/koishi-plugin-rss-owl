/**
 * error-tracker 单元测试
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

type MockLogger = {
  info: jest.Mock<any>
  warn: jest.Mock<any>
  error: jest.Mock<any>
}

type MockScope = {
  setContext: jest.Mock<any>
  setUser: jest.Mock<any>
  setTag: jest.Mock<any>
}

describe('error-tracker', () => {
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.resetModules()
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    jest.resetModules()
  })

  function mockCoreLogger(): MockLogger {
    const mockedLogger: MockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    jest.doMock('../../src/utils/logger', () => ({ logger: mockedLogger }))
    return mockedLogger
  }

  it('应在启用错误追踪但缺少 Sentry 依赖时通过主日志入口告警且仅告警一次', () => {
    const mockedLogger = mockCoreLogger()
    let ErrorTracker: any

    jest.isolateModules(() => {
      ({ ErrorTracker } = require('../../src/utils/error-tracker'))
    })

    const tracker = new ErrorTracker({ enabled: true, dsn: 'test-dsn' })
    tracker.init()
    tracker.init()

    expect(mockedLogger.warn).toHaveBeenCalledTimes(2)
    expect(mockedLogger.warn).toHaveBeenNthCalledWith(1, '[error-tracker] Sentry not installed. Error tracking will be disabled.')
    expect(mockedLogger.warn).toHaveBeenNthCalledWith(2, '[error-tracker] To enable error tracking, install: npm install @sentry/node')
    expect(mockedLogger.error).not.toHaveBeenCalled()
    expect(consoleWarnSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('应在 Sentry 初始化失败时通过主日志入口记录错误', () => {
    const mockedLogger = mockCoreLogger()
    const initMock = jest.fn(() => {
      throw new Error('init failed')
    })

    jest.doMock('@sentry/node', () => ({
      init: initMock,
      defaultIntegrations: [],
    }), { virtual: true })

    let ErrorTracker: any

    jest.isolateModules(() => {
      ({ ErrorTracker } = require('../../src/utils/error-tracker'))
    })

    const tracker = new ErrorTracker({ enabled: true, dsn: 'test-dsn' })
    tracker.init()

    expect(initMock).toHaveBeenCalledTimes(1)
    expect(mockedLogger.warn).not.toHaveBeenCalled()
    expect(mockedLogger.error).toHaveBeenCalledTimes(1)
    expect(String(mockedLogger.error.mock.calls[0][0])).toContain('[error-tracker] Failed to initialize Sentry: init failed')
    expect(consoleWarnSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('未启用或缺少 dsn 时应静默返回', () => {
    const mockedLogger = mockCoreLogger()
    let ErrorTracker: any

    jest.isolateModules(() => {
      ({ ErrorTracker } = require('../../src/utils/error-tracker'))
    })

    const disabledTracker = new ErrorTracker({ enabled: false, dsn: 'test-dsn' })
    disabledTracker.init()

    const emptyDsnTracker = new ErrorTracker({ enabled: true, dsn: '' })
    emptyDsnTracker.init()

    expect(disabledTracker.isInitialized()).toBe(false)
    expect(emptyDsnTracker.isInitialized()).toBe(false)
    expect(mockedLogger.warn).not.toHaveBeenCalled()
    expect(mockedLogger.error).not.toHaveBeenCalled()
    expect(consoleWarnSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('initErrorTracker 应在已有未初始化实例时重新创建追踪器', () => {
    const mockedLogger = mockCoreLogger()
    let initErrorTracker: any

    jest.isolateModules(() => {
      ({ initErrorTracker } = require('../../src/utils/error-tracker'))
    })

    const firstTracker = initErrorTracker({ enabled: false, dsn: '' })
    const secondTracker = initErrorTracker({ enabled: false, dsn: '' })

    expect(firstTracker).not.toBe(secondTracker)
    expect(firstTracker.isInitialized()).toBe(false)
    expect(secondTracker.isInitialized()).toBe(false)
    expect(mockedLogger.warn).not.toHaveBeenCalled()
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })

  it('withErrorTracking 应归一化非 Error 异常后上报', () => {
    const mockedLogger = mockCoreLogger()
    const captureException = jest.fn()
    const scope: MockScope = {
      setContext: jest.fn(),
      setUser: jest.fn(),
      setTag: jest.fn(),
    }

    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      defaultIntegrations: [],
      withScope: (callback: (scopeInstance: MockScope) => void) => callback(scope),
      captureException,
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      setUser: jest.fn(),
      setTag: jest.fn(),
      setContext: jest.fn(),
      startInactiveSpan: jest.fn(),
    }), { virtual: true })

    let initErrorTracker: any
    let withErrorTracking: any

    jest.isolateModules(() => {
      ({ initErrorTracker, withErrorTracking } = require('../../src/utils/error-tracker'))
    })

    initErrorTracker({ enabled: true, dsn: 'test-dsn' })

    const wrapped = withErrorTracking(
      () => {
        throw { message: 'object boom', code: 'E_OBJECT' }
      },
      { command: 'rsso.pull', guildId: 'guild-1', userId: 'user-1', platform: 'onebot' }
    )

    expect(() => wrapped()).toThrow()
    expect(captureException).toHaveBeenCalledTimes(1)
    const trackedError = captureException.mock.calls[0][0] as Error & { code?: string }
    expect(trackedError).toBeInstanceOf(Error)
    expect(trackedError.message).toBe('object boom')
    expect(trackedError.code).toBe('E_OBJECT')
    expect(scope.setContext).toHaveBeenCalledWith('custom_context', {
      command: 'rsso.pull',
      guildId: 'guild-1',
      userId: 'user-1',
      platform: 'onebot',
    })
    expect(mockedLogger.warn).not.toHaveBeenCalled()
    expect(mockedLogger.error).not.toHaveBeenCalled()
  })
})