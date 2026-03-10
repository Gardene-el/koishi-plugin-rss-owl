import axios from 'axios'

import { Config } from '../types'
import { debug } from '../utils/logger'
import { buildAxiosProxyConfig } from '../utils/proxy'

export interface SummaryResult {
  success: boolean
  summary: string
  cached: boolean
  error?: string
}

export async function requestAiText(
  config: Config,
  prompt: string,
  options: {
    temperature?: number
    timeout?: number
  } = {}
): Promise<string> {
  const requestConfig: any = {
    headers: {
      'Authorization': `Bearer ${config.ai!.apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: options.timeout ?? config.ai?.timeout,
    ...buildAxiosProxyConfig(config)
  }

  const response = await axios.post(
    `${config.ai!.baseUrl!.replace(/\/+$/, '')}/chat/completions`,
    {
      model: config.ai!.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.7
    },
    requestConfig
  )

  const summary = response.data?.choices?.[0]?.message?.content?.trim()
  if (!summary) {
    throw new Error('AI 返回空结果')
  }

  return summary
}

export async function callAiApi(
  config: Config,
  prompt: string,
  context: string
): Promise<SummaryResult> {
  const maxRetries = 2

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      debug(config, `AI 请求尝试 ${attempt + 1}/${maxRetries + 1}: ${context}`, 'AI', 'info')
      const summary = await requestAiText(config, prompt)

      debug(config, `AI 摘要生成成功: ${summary.substring(0, 20)}...`, 'AI', 'details')
      return {
        success: true,
        summary,
        cached: false
      }
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries

      debug(
        config,
        `AI 请求失败 (尝试 ${attempt + 1}/${maxRetries + 1}): ${error.message}`,
        'AI',
        isLastAttempt ? 'error' : 'info'
      )

      if (isLastAttempt) {
        return {
          success: false,
          summary: '',
          cached: false,
          error: error.message
        }
      }

      const waitTime = Math.pow(2, attempt) * 1000
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
  }

  return {
    success: false,
    summary: '',
    cached: false,
    error: '未知错误'
  }
}