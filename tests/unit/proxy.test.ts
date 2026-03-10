import { describe, expect, it } from '@jest/globals'
import { HttpsProxyAgent } from 'https-proxy-agent'

import { buildAxiosProxyConfig } from '../../src/utils/proxy'
import type { Config } from '../../src/types'

describe('buildAxiosProxyConfig', () => {
  it('代理未启用时返回空对象', () => {
    const config = {
      net: {
        proxyAgent: {
          enabled: false,
        },
      },
    } as Config

    expect(buildAxiosProxyConfig(config)).toEqual({})
  })

  it('代理启用时返回 httpsAgent 与 proxy false', () => {
    const config = {
      net: {
        proxyAgent: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
        },
      },
    } as Config

    const result = buildAxiosProxyConfig(config)

    expect(result.proxy).toBe(false)
    expect(result.httpsAgent).toBeInstanceOf(HttpsProxyAgent)
  })
})