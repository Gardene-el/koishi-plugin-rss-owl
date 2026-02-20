/**
 * 测试模型轮询和自动引擎选择功能
 */

import { webSearch } from '../lib/core/search'
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

async function testModelRotation() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║       测试火山引擎模型轮询功能                            ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  const searchConfig: SearchConfig = {
    enabled: true,
    engine: 'volcengine',
    maxResults: 3,
    volcengine: {
      apiKey: '071126d1-6d02-48b7-a4c8-4d2ede320560',
      models: [
        'doubao-seed-1-6-lite-251015',
        'doubao-seed-1-6-flash-250828'
      ],
      useAiModel: false  // 使用自定义模型列表
    }
  }

  console.log('配置的模型列表:')
  searchConfig.volcengine.models?.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m}`)
  })
  console.log('')

  // 执行多次搜索，观察模型轮询
  for (let i = 1; i <= 3; i++) {
    console.log(`【第 ${i} 次搜索】`)
    const result = await webSearch(testConfig, '今天的科技新闻', searchConfig)

    console.log(`  状态: ${result.success ? '成功' : '失败'}`)
    console.log(`  引擎: ${result.engine}`)
    console.log(`  模型: ${result.model || '未指定'}`)
    console.log(`  结果数: ${result.results.length}`)

    if (result.results.length > 0) {
      console.log(`  示例: ${result.results[0].title.substring(0, 40)}...`)
    }

    console.log('')

    // 等待一秒，避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

async function testAutoEngineSelection() {
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║       测试自动引擎选择功能                                ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // 配置所有三个引擎
  const searchConfig: SearchConfig = {
    enabled: true,
    engine: 'auto',  // 自动选择
    maxResults: 3,
    enginePriority: ['tavily', 'volcengine', 'searxng'],  // 优先级
    tavily: {
      apiKey: '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',
      searchDepth: 'basic'
    },
    searxng: {
      instanceUrl: 'http://10.126.126.3:11068',
      language: 'zh'
    },
    volcengine: {
      apiKey: '071126d1-6d02-48b7-a4c8-4d2ede320560',
      useAiModel: false
    }
  }

  console.log('配置的搜索引擎优先级:')
  searchConfig.enginePriority?.forEach((engine, i) => {
    const status = engine === 'tavily' ? '✓' : engine === 'searxng' ? '✓' : engine === 'volcengine' ? '✓' : '?'
    console.log(`  ${i + 1}. ${engine} ${status}`)
  })
  console.log('')

  console.log('【执行搜索】')
  const result = await webSearch(testConfig, '人工智能最新进展', searchConfig)

  console.log(`  状态: ${result.success ? '成功' : '失败'}`)
  console.log(`  使用引擎: ${result.engine}`)
  console.log(`  使用模型: ${result.model || '未指定'}`)
  console.log(`  结果数: ${result.results.length}`)

  if (result.results.length > 0) {
    console.log(`\n  搜索结果:`)
    result.results.forEach((r, i) => {
      console.log(`    [${i + 1}] ${r.title}`)
    })
  }

  if (result.error) {
    console.log(`\n  错误: ${result.error}`)
  }
}

async function testAllEnginesConfigured() {
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║       测试三引擎配置时的使用情况                          ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // 配置所有引擎，使用 auto 模式
  const searchConfig: SearchConfig = {
    enabled: true,
    engine: 'auto',
    maxResults: 5,
    enginePriority: ['tavily', 'volcengine', 'searxng'],
    tavily: {
      apiKey: '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'
    },
    searxng: {
      instanceUrl: 'http://10.126.126.3:11068'
    },
    volcengine: {
      apiKey: '071126d1-6d02-48b7-a4c8-4d2ede320560',
      models: [
        'doubao-seed-1-6-lite-251015',
        'doubao-seed-1-6-flash-250828'
      ]
    }
  }

  console.log('场景: 三个引擎都已配置，使用 auto 模式')
  console.log('预期: 按优先级尝试 Tavily → 火山引擎 → SearXNG')
  console.log('')

  console.log('【搜索查询】: 区块链技术')
  const result = await webSearch(testConfig, '区块链技术', searchConfig)

  console.log(`\n结果:`)
  console.log(`  ✓ 成功: ${result.success}`)
  console.log(`  ✓ 使用引擎: ${result.engine}`)
  console.log(`  ✓ 使用模型: ${result.model || '未指定'}`)
  console.log(`  ✓ 结果数: ${result.results.length}`)

  if (result.results.length > 0) {
    console.log(`\n  前 3 条结果:`)
    result.results.slice(0, 3).forEach((r, i) => {
      console.log(`    [${i + 1}] ${r.title}`)
    })
  }
}

async function runAllTests() {
  try {
    await testModelRotation()
    await testAutoEngineSelection()
    await testAllEnginesConfigured()

    console.log('\n╔════════════════════════════════════════════════════════════╗')
    console.log('║       测试完成                                            ║')
    console.log('╚════════════════════════════════════════════════════════════╝\n')
    console.log('🎉 所有测试完成！')
  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
  }
}

runAllTests()
