import type { AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'

import type { Config } from '../types'

export function buildAxiosProxyConfig(config: Config): Pick<AxiosRequestConfig, 'httpsAgent' | 'proxy'> {
  if (!config.net?.proxyAgent?.enabled) {
    return {}
  }

  const proxyUrl = `${config.net.proxyAgent.protocol}://${config.net.proxyAgent.host}:${config.net.proxyAgent.port}`
  return {
    httpsAgent: new HttpsProxyAgent(proxyUrl),
    proxy: false,
  }
}