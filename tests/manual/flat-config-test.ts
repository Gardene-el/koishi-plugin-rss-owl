/**
 * 测试扁平化配置转换
 */

import { normalizeSearchConfig } from '../../lib/config'
import { webSearch } from '../../lib/core/search'
import { Config } from '../../lib/types'

// 模拟扁平化的 WebUI 配置
const flatSearchConfig = {
  enabled: true,
  engine: 'auto' as const,
  maxResults: 5,
  enginePriority: ['tavily', 'volcengine', 'searxng'] as const,
  tavilyApiKey: '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',
  tavilySearchDepth: 'basic' as const,
  tavilyIncludeAnswer: true,
  searxngInstanceUrl: 'http://10.126.126.3:11068',
  searxngLanguage: 'zh',
  volcengineApiKey: '071126d1-6d02-48b7-a4c8-4d2ede320560',
  volcengineModels: 'doubao-seed-1-6-lite-251015,doubao-seed-1-6-flash-250828',
  volcengineUseAiModel: false
}

const testConfig: Config = {
  ai: {
    enabled: true,
    apiKey: 'sk-test',
    model: 'gpt-3.5-turbo',
    timeout: 60000
  },
  search: flatSearchConfig as any, // 使用扁平化配置
  net: { proxyAgent: { enabled: false } },
  debug: 'info'
}

async function testFlatConfig() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║       测试扁平化配置转换                                   ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // 转换配置
  const normalizedConfig = normalizeSearchConfig(flatSearchConfig)

  console.log('原始配置（扁平化）:')
  console.log(JSON.stringify(flatSearchConfig, null, 2))
  console.log('')

  console.log('转换后配置（嵌套）:')
  console.log(JSON.stringify(normalizedConfig, null, 2))
  console.log('')

  // 验证转换结果
  console.log('验证转换结果:')
  console.log(`  ✓ enabled: ${normalizedConfig.enabled}`)
  console.log(`  ✓ engine: ${normalizedConfig.engine}`)
  console.log(`  ✓ maxResults: ${normalizedConfig.maxResults}`)
  console.log(`  ✓ tavily.apiKey: ${normalizedConfig.tavily?.apiKey?.substring(0, 15)}...`)
  console.log(`  ✓ searxng.instanceUrl: ${normalizedConfig.searxng?.instanceUrl}`)
  console.log(`  ✓ volcengine.apiKey: ${normalizedConfig.volcengine?.apiKey?.substring(0, 15)}...`)
  console.log(`  ✓ volcengine.models: ${normalizedConfig.volcengine?.models?.join(', ')}`)
  console.log('')

  // 使用转换后的配置执行搜索
  console.log('【使用转换后的配置执行搜索】\n')

  const result = await webSearch(testConfig, '人工智能最新进展', normalizedConfig)

  console.log('搜索结果:')
  console.log(`  状态: ${result.success ? '成功' : '失败'}`)
  console.log(`  引擎: ${result.engine}`)
  console.log(`  模型: ${result.model || '未指定'}`)
  console.log(`  结果数: ${result.results.length}`)

  if (result.results.length > 0) {
    console.log(`\n  前 3 条结果:`)
    result.results.slice(0, 3).forEach((r, i) => {
      console.log(`    [${i + 1}] ${r.title}`)
    })
  }

  if (result.error) {
    console.log(`\n  错误: ${result.error}`)
  }

  console.log('\n✅ 配置转换测试完成！')
}

testFlatConfig().catch(console.error)
