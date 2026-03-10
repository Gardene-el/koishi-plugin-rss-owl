/**
 * 命令工具函数测试
 */

import { describe, it, expect } from '@jest/globals'
import { checkAuthority, parseTarget, parseTargets, isValidUrl, extractSessionInfo, buildCommandLogContext } from '../../src/commands/utils'

function createMockSession(overrides: Record<string, any> = {}) {
  return {
    event: {
      guild: { id: 'guild-123' },
      user: { id: 'user-456' },
      platform: 'onebot',
      ...overrides.event,
    },
    user: {
      authority: 4,
      ...overrides.user,
    },
    ...overrides,
  } as any
}

describe('命令工具函数', () => {
  describe('checkAuthority', () => {
    it('应该在权限足够时返回成功', () => {
      const result = checkAuthority(5, 3)
      expect(result.success).toBe(true)
    })

    it('应该在权限不足时返回失败', () => {
      const result = checkAuthority(2, 5)
      expect(result.success).toBe(false)
      expect(result.message).toBe('权限不足')
    })

    it('应该支持自定义错误消息', () => {
      const result = checkAuthority(1, 3, '需要管理员权限')
      expect(result.success).toBe(false)
      expect(result.message).toBe('需要管理员权限')
    })

    it('应该正确处理相等的权限', () => {
      const result = checkAuthority(3, 3)
      expect(result.success).toBe(true)
    })
  })

  describe('parseTarget', () => {
    it('应该正确解析冒号分隔的目标', () => {
      const result = parseTarget('one:two')
      expect(result).toEqual({
        platform: 'one',
        guildId: 'two'
      })
    })

    it('应该正确解析中文冒号分隔的目标', () => {
      const result = parseTarget('one：two')
      expect(result).toEqual({
        platform: 'one',
        guildId: 'two'
      })
    })

    it('应该在格式错误时返回 null', () => {
      const result = parseTarget('invalid')
      expect(result).toBeNull()
    })

    it('应该处理多个冒号的情况', () => {
      const result = parseTarget('one:two:three')
      expect(result).toBeNull()
    })

    it('应该处理空字符串', () => {
      const result = parseTarget('')
      expect(result).toBeNull()
    })
  })

  describe('parseTargets', () => {
    it('应该正确解析单个目标', () => {
      const result = parseTargets('onebot:123456')
      expect(result).toEqual({ targets: ['onebot:123456'] })
    })

    it('应该正确解析多个目标和多种分隔符', () => {
      const result = parseTargets('onebot:123456, telegram:456789；discord:abc')
      expect(result).toEqual({ targets: ['onebot:123456', 'telegram:456789', 'discord:abc'] })
    })

    it('应该在无输入时返回空数组', () => {
      const result = parseTargets()
      expect(result).toEqual({ targets: [] })
    })

    it('应该在目标格式错误时返回 invalidTarget', () => {
      const result = parseTargets('onebot:123456, invalid-target')
      expect(result).toEqual({ targets: [], invalidTarget: 'invalid-target' })
    })
  })

  describe('isValidUrl', () => {
    it('应该接受有效的 HTTP URL', () => {
      expect(isValidUrl('http://example.com')).toBe(true)
    })

    it('应该接受有效的 HTTPS URL', () => {
      expect(isValidUrl('https://example.com')).toBe(true)
    })

    it('应该接受带路径的 URL', () => {
      expect(isValidUrl('https://example.com/path/to/resource')).toBe(true)
    })

    it('应该接受带查询参数的 URL', () => {
      expect(isValidUrl('https://example.com?query=value')).toBe(true)
    })

    it('应该拒绝无效的 URL', () => {
      expect(isValidUrl('not-a-url')).toBe(false)
    })

    it('应该拒绝空字符串', () => {
      expect(isValidUrl('')).toBe(false)
    })

    it('应该拒绝缺少协议的 URL', () => {
      expect(isValidUrl('example.com')).toBe(false)
    })
  })
})

describe('会话上下文工具', () => {
  it('应该从会话中提取基本信息', () => {
    const session = createMockSession()
    expect(extractSessionInfo(session)).toEqual({
      guildId: 'guild-123',
      platform: 'onebot',
      authorId: 'user-456',
      authority: 4,
    })
  })

  it('应该构建命令日志上下文', () => {
    const session = createMockSession()
    expect(buildCommandLogContext(session, 'rsso.pull', 'pull')).toEqual({
      guildId: 'guild-123',
      platform: 'onebot',
      authorId: 'user-456',
      authority: 4,
      userId: 'user-456',
      command: 'rsso.pull',
      operation: 'pull',
    })
  })

  it('应该在未传入 command 和 operation 时保留基础上下文', () => {
    const session = createMockSession()
    expect(buildCommandLogContext(session)).toEqual({
      guildId: 'guild-123',
      platform: 'onebot',
      authorId: 'user-456',
      authority: 4,
      userId: 'user-456',
    })
  })
})
