import { searchWithVolcengine } from '../src/core/search'
import { Config } from '../src/types'

const testConfig: Config = {
  ai: {
    enabled: true,
    apiKey: '071126d1-6d02-48b7-a4c8-4d2ede320560',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1.6-250615',
    timeout: 30000
  },
  net: {
    proxyAgent: { enabled: false }
  },
  debug: 'info'
}

async function test() {
  console.log('测试火山引擎搜索: 今天北京的天气')
  const result = await searchWithVolcengine(
    testConfig,
    '今天北京的天气',
    testConfig.ai.baseUrl!,
    testConfig.ai.apiKey!,
    testConfig.ai.model!
  )
  
  console.log('成功:', result.success)
  console.log('结果数:', result.results.length)
  if (result.results.length > 0) {
    result.results.forEach((r, i) => {
      console.log(`[${i+1}] ${r.title}`)
    })
  }
}

test().catch(console.error)
