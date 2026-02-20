import { searchWithVolcengine } from '../lib/core/search'
import { Config } from '../lib/types'

const testConfig: Config = {
  ai: {
    enabled: true,
    apiKey: '071126d1-6d02-48b7-a4c8-4d2ede320560',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1.6-250615',
    timeout: 60000  // 60秒超时
  },
  net: {
    proxyAgent: { enabled: false }
  },
  debug: 'info'
}

async function test() {
  console.log('=== 测试火山引擎搜索 ===\n')
  console.log('查询: 今天北京的天气')
  console.log('模型: doubao-seed-1.6-250615')
  console.log('超时: 60秒\n')

  const result = await searchWithVolcengine(
    testConfig,
    '今天北京的天气',
    testConfig.ai.baseUrl!,
    testConfig.ai.apiKey!,
    testConfig.ai.model!
  )

  console.log('\n=== 结果 ===')
  console.log('成功:', result.success)
  console.log('引擎:', result.engine)
  console.log('结果数:', result.results.length)

  if (result.results.length > 0) {
    console.log('\n搜索结果:')
    result.results.forEach((r, i) => {
      console.log(`\n[${i + 1}] ${r.title}`)
      console.log(`    URL: ${r.url}`)
      console.log(`    来源: ${r.source}`)
      if (r.publishedDate) {
        console.log(`    发布时间: ${r.publishedDate}`)
      }
      console.log(`    摘要: ${r.snippet?.substring(0, 100)}...`)
    })
  } else {
    console.log('\n⚠️  未找到搜索结果')
  }

  if (result.error) {
    console.log(`\n错误: ${result.error}`)
  }
}

test().catch(console.error)
