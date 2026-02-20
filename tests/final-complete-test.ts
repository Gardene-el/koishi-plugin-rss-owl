import { searchWithTavily, searchWithSearxng, searchWithVolcengine, webSearch } from '../lib/core/search'
import { Config, SearchConfig } from '../lib/types'

const testConfig: Config = {
  ai: {
    enabled: true,
    apiKey: '071126d1-6d02-48b7-a4c8-4d2ede320560',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1.6-250615',
    timeout: 60000
  },
  net: { proxyAgent: { enabled: false } },
  debug: 'info'
}

async function testAllEngines() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║       联网搜索功能完整测试                                  ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  const results: any[] = []

  // 测试 Tavily
  console.log('【1/3】测试 Tavily 搜索')
  try {
    const r1 = await searchWithTavily(testConfig, '人工智能最新进展', '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', { maxResults: 3 })
    results.push({ engine: 'Tavily', success: r1.success, count: r1.results.length })
    console.log(`  ✓ 状态: ${r1.success ? '成功' : '失败'}`)
    console.log(`  ✓ 结果数: ${r1.results.length}`)
    if (r1.results.length > 0) {
      console.log(`  ✓ 示例: ${r1.results[0].title.substring(0, 40)}...`)
    }
  } catch (e: any) {
    results.push({ engine: 'Tavily', success: false, count: 0, error: e.message })
    console.log(`  ✗ 错误: ${e.message}`)
  }

  console.log('')

  // 测试 SearXNG
  console.log('【2/3】测试 SearXNG 搜索')
  try {
    const r2 = await searchWithSearxng(testConfig, 'Rust 编程语言', 'http://10.126.126.3:11068', { maxResults: 3 })
    results.push({ engine: 'SearXNG', success: r2.success, count: r2.results.length })
    console.log(`  ✓ 状态: ${r2.success ? '成功' : '失败'}`)
    console.log(`  ✓ 结果数: ${r2.results.length}`)
    if (r2.results.length > 0) {
      console.log(`  ✓ 示例: ${r2.results[0].title.substring(0, 40)}...`)
    }
  } catch (e: any) {
    results.push({ engine: 'SearXNG', success: false, count: 0, error: e.message })
    console.log(`  ✗ 错误: ${e.message}`)
  }

  console.log('')

  // 测试火山引擎
  console.log('【3/3】测试火山引擎搜索')
  try {
    const r3 = await searchWithVolcengine(
      testConfig,
      '今天的新闻',
      testConfig.ai.baseUrl!,
      testConfig.ai.apiKey!,
      testConfig.ai.model!
    )
    results.push({ engine: '火山引擎', success: r3.success, count: r3.results.length })
    console.log(`  ✓ 状态: ${r3.success ? '成功' : '失败'}`)
    console.log(`  ✓ 结果数: ${r3.results.length}`)
    if (r3.results.length > 0) {
      console.log(`  ✓ 示例: ${r3.results[0].title.substring(0, 40)}...`)
    }
  } catch (e: any) {
    results.push({ engine: '火山引擎', success: false, count: 0, error: e.message })
    console.log(`  ✗ 错误: ${e.message}`)
  }

  console.log('\n')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║       测试总结                                              ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  const allPassed = results.every(r => r.success)
  results.forEach(r => {
    const status = r.success ? '✓ 通过' : '✗ 失败'
    const count = r.success ? `(${r.count} 条结果)` : ''
    console.log(`  ${r.engine.padEnd(12)} ${status} ${count}`)
    if (r.error) {
      console.log(`              ${r.error}`)
    }
  })

  console.log('\n' + (allPassed ? '🎉 所有测试通过！' : '⚠️  部分测试失败') + '\n')
}

testAllEngines().catch(console.error)
