/**
 * 联网搜索功能测试脚本
 */

import { searchWithTavily, searchWithSearxng, searchWithVolcengine, webSearch } from '../src/core/search'
import { Config, SearchConfig } from '../src/types'

// 测试配置
const testConfig: Config = {
  ai: {
    enabled: true,
    apiKey: 'sk-test',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1.6-250615',
    timeout: 30000
  },
  net: {
    proxyAgent: {
      enabled: false
    }
  },
  debug: 'details'
}

// 测试 API Keys
const TAVILY_API_KEY = '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'
const SEARXNG_URL = 'http://10.126.126.3:11068'
const VOLCENGINE_API_KEY = '071126d1-6d02-48b7-a4c8-4d2ede320560'

/**
 * 测试 Tavily 搜索
 */
async function testTavily() {
  console.log('\n=== 测试 Tavily 搜索 ===')
  console.log('API Key:', TAVILY_API_KEY.substring(0, 15) + '...')
  console.log('搜索查询: "人工智能最新进展"')

  try {
    const result = await searchWithTavily(
      testConfig,
      '人工智能最新进展',
      TAVILY_API_KEY,
      {
        maxResults: 3,
        searchDepth: 'basic',
        includeAnswer: true
      }
    )

    console.log('\n结果:')
    console.log('- 成功:', result.success)
    console.log('- 引擎:', result.engine)
    console.log('- 查询:', result.query)

    if (result.success) {
      console.log('- 结果数量:', result.results.length)
      result.results.forEach((item, index) => {
        console.log(`\n  [${index + 1}] ${item.title}`)
        console.log(`      URL: ${item.url}`)
        console.log(`      摘要: ${item.snippet?.substring(0, 100)}...`)
      })
    } else {
      console.log('- 错误:', result.error)
    }

    return result.success
  } catch (error: any) {
    console.log('异常:', error.message)
    return false
  }
}

/**
 * 测试 SearXNG 搜索
 */
async function testSearxng() {
  console.log('\n=== 测试 SearXNG 搜索 ===')
  console.log('实例 URL:', SEARXNG_URL)
  console.log('搜索查询: "TypeScript 编程"')

  try {
    const result = await searchWithSearxng(
      testConfig,
      'TypeScript 编程',
      SEARXNG_URL,
      {
        maxResults: 3,
        language: 'zh',
        categories: ['general']
      }
    )

    console.log('\n结果:')
    console.log('- 成功:', result.success)
    console.log('- 引擎:', result.engine)
    console.log('- 查询:', result.query)

    if (result.success) {
      console.log('- 结果数量:', result.results.length)
      result.results.forEach((item, index) => {
        console.log(`\n  [${index + 1}] ${item.title}`)
        console.log(`      URL: ${item.url}`)
        console.log(`      来源: ${item.source}`)
        console.log(`      摘要: ${item.snippet?.substring(0, 100)}...`)
      })
    } else {
      console.log('- 错误:', result.error)
    }

    return result.success
  } catch (error: any) {
    console.log('异常:', error.message)
    return false
  }
}

/**
 * 测试火山引擎搜索
 */
async function testVolcengine() {
  console.log('\n=== 测试火山引擎搜索 ===')
  console.log('API Key:', VOLCENGINE_API_KEY)
  console.log('Base URL:', testConfig.ai.baseUrl)
  console.log('模型:', testConfig.ai.model)
  console.log('搜索查询: "今天的天气"')

  try {
    const result = await searchWithVolcengine(
      testConfig,
      '今天的天气',
      testConfig.ai.baseUrl!,
      VOLCENGINE_API_KEY,
      testConfig.ai.model!
    )

    console.log('\n结果:')
    console.log('- 成功:', result.success)
    console.log('- 引擎:', result.engine)
    console.log('- 查询:', result.query)

    if (result.success) {
      console.log('- 结果数量:', result.results.length)
      result.results.forEach((item, index) => {
        console.log(`\n  [${index + 1}] ${item.title}`)
        console.log(`      URL: ${item.url}`)
        if (item.publishedDate) {
          console.log(`      发布时间: ${item.publishedDate}`)
        }
        console.log(`      摘要: ${item.snippet?.substring(0, 100)}...`)
      })
    } else {
      console.log('- 错误:', result.error)
    }

    return result.success
  } catch (error: any) {
    console.log('异常:', error.message)
    return false
  }
}

/**
 * 测试统一搜索接口
 */
async function testUnifiedSearch() {
  console.log('\n=== 测试统一搜索接口 ===')

  const searchConfigs: SearchConfig[] = [
    {
      enabled: true,
      engine: 'tavily',
      maxResults: 2,
      tavily: {
        apiKey: TAVILY_API_KEY,
        searchDepth: 'basic',
        includeAnswer: true
      }
    },
    {
      enabled: true,
      engine: 'searxng',
      maxResults: 2,
      searxng: {
        instanceUrl: SEARXNG_URL,
        language: 'zh',
        categories: ['general']
      }
    },
    {
      enabled: true,
      engine: 'volcengine',
      maxResults: 2,
      volcengine: {
        apiKey: VOLCENGINE_API_KEY
      }
    }
  ]

  const results: { engine: string; success: boolean; error?: string }[] = []

  for (const searchConfig of searchConfigs) {
    console.log(`\n测试 ${searchConfig.engine} 统一接口...`)
    try {
      const result = await webSearch(testConfig, '测试查询', searchConfig)
      results.push({
        engine: searchConfig.engine,
        success: result.success,
        error: result.error
      })
      console.log(`  ✓ ${searchConfig.engine}: ${result.success ? '成功' : '失败'}`)
      if (!result.success) {
        console.log(`    错误: ${result.error}`)
      }
    } catch (error: any) {
      results.push({
        engine: searchConfig.engine,
        success: false,
        error: error.message
      })
      console.log(`  ✗ ${searchConfig.engine}: 异常 - ${error.message}`)
    }
  }

  return results
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║       联网搜索功能测试                                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')

  const results = {
    tavily: false,
    searxng: false,
    volcengine: false,
    unified: [] as any[]
  }

  // 测试 Tavily
  results.tavily = await testTavily()

  // 测试 SearXNG
  results.searxng = await testSearxng()

  // 测试火山引擎
  results.volcengine = await testVolcengine()

  // 测试统一接口
  results.unified = await testUnifiedSearch()

  // 输出总结
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║       测试总结                                             ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('\n直接接口测试:')
  console.log(`  Tavily:       ${results.tavily ? '✓ 通过' : '✗ 失败'}`)
  console.log(`  SearXNG:      ${results.searxng ? '✓ 通过' : '✗ 失败'}`)
  console.log(`  火山引擎:      ${results.volcengine ? '✓ 通过' : '✗ 失败'}`)

  console.log('\n统一接口测试:')
  results.unified.forEach(r => {
    console.log(`  ${r.engine.padEnd(12)} ${r.success ? '✓ 通过' : '✗ 失败'}`)
    if (r.error) {
      console.log(`               错误: ${r.error}`)
    }
  })

  const allPassed = results.tavily && results.searxng && results.volcengine &&
    results.unified.every(r => r.success)

  console.log('\n' + (allPassed ? '🎉 所有测试通过！' : '⚠️  部分测试失败'))
}

// 运行测试
runAllTests().catch(console.error)
