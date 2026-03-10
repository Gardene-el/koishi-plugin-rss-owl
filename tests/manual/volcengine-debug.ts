/**
 * 火山引擎搜索调试
 */

import axios from 'axios'
import { Config } from '../../src/types'

const API_KEY = '071126d1-6d02-48b7-a4c8-4d2ede320560'
const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const MODEL = 'doubao-seed-1.6-250615'

const testConfig: Config = {
  ai: {
    enabled: true,
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    model: MODEL,
    timeout: 30000
  },
  net: {
    proxyAgent: {
      enabled: false
    }
  }
}

async function testVolcengineSearchParsing() {
  console.log('测试火山引擎搜索结果解析...\n')

  const requestConfig = {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  }

  const query = '今天北京的天气'
  console.log('搜索查询:', query)
  console.log('')

  try {
    const response = await axios.post(
      `${BASE_URL}/responses`,
      {
        model: MODEL,
        input: [
          {
            role: 'user',
            content: query
          }
        ],
        tools: [
          {
            type: 'web_search'
          }
        ]
      },
      requestConfig
    )

    console.log('响应状态:', response.status)
    console.log('')

    const data = response.data

    // 检查 output 结构
    if (data.output && Array.isArray(data.output)) {
      console.log('Output 数组长度:', data.output.length)
      console.log('')

      let searchResults: any[] = []

      for (let i = 0; i < data.output.length; i++) {
        const outputItem = data.output[i]
        console.log(`Output[${i}]:`)
        console.log('  类型:', outputItem.type)
        console.log('  状态:', outputItem.status)

        if (outputItem.type === 'message' &&
            outputItem.role === 'assistant' &&
            outputItem.content &&
            Array.isArray(outputItem.content)) {

          console.log('  内容项数量:', outputItem.content.length)

          for (let j = 0; j < outputItem.content.length; j++) {
            const contentItem = outputItem.content[j]
            console.log(`    Content[${j}]:`)
            console.log('      类型:', contentItem.type)

            if (contentItem.type === 'output_text') {
              console.log('      文本长度:', contentItem.text?.length)
              console.log('      Annotations 数量:', contentItem.annotations?.length || 0)

              if (contentItem.annotations && Array.isArray(contentItem.annotations)) {
                console.log('')
                console.log('      提取的搜索结果:')

                for (let k = 0; k < contentItem.annotations.length; k++) {
                  const annotation = contentItem.annotations[k]
                  if (annotation.type === 'url_citation') {
                    searchResults.push({
                      title: annotation.title,
                      url: annotation.url,
                      source: annotation.site_name,
                      publishTime: annotation.publish_time
                    })
                    console.log(`        [${k + 1}] ${annotation.title}`)
                    console.log(`            URL: ${annotation.url}`)
                    console.log(`            来源: ${annotation.site_name}`)
                  }
                }
              }
            }
          }
        }
        console.log('')
      }

      console.log('总计找到搜索结果:', searchResults.length)
    } else {
      console.log('Output 格式不符预期')
    }

  } catch (error: any) {
    console.log('错误:', error.message)
    if (error.response) {
      console.log('响应状态:', error.response.status)
    }
  }
}

testVolcengineSearchParsing().catch(console.error)
