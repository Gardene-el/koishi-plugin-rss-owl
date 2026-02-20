/**
 * 火山引擎 API 响应格式测试
 */

import axios from 'axios'

const API_KEY = '071126d1-6d02-48b7-a4c8-4d2ede320560'
const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const MODEL = 'doubao-seed-1.6-250615'

async function testVolcengineAPI() {
  console.log('测试火山引擎 API...')
  console.log('API Key:', API_KEY)
  console.log('Base URL:', BASE_URL)
  console.log('Model:', MODEL)
  console.log('')

  const requestConfig = {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  }

  // 测试 1: Responses API
  console.log('=== 测试 1: Responses API ===')
  try {
    const response = await axios.post(
      `${BASE_URL}/responses`,
      {
        model: MODEL,
        input: [
          {
            role: 'user',
            content: '今天北京的天气怎么样'
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

    console.log('状态码:', response.status)
    console.log('响应数据结构:')
    console.log(JSON.stringify(response.data, null, 2))
  } catch (error: any) {
    console.log('错误:', error.message)
    if (error.response) {
      console.log('响应状态:', error.response.status)
      console.log('响应数据:', error.response.data)
    }
  }

  console.log('\n')

  // 测试 2: Chat Completions API with tools
  console.log('=== 测试 2: Chat Completions API with Tools ===')
  try {
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: '今天北京的天气怎么样'
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: '搜索互联网信息'
            }
          }
        ]
      },
      requestConfig
    )

    console.log('状态码:', response.status)
    console.log('响应数据结构:')
    console.log(JSON.stringify(response.data, null, 2))
  } catch (error: any) {
    console.log('错误:', error.message)
    if (error.response) {
      console.log('响应状态:', error.response.status)
      console.log('响应数据:', error.response.data)
    }
  }
}

testVolcengineAPI().catch(console.error)
