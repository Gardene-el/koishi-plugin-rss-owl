import axios from 'axios'

const API_KEY = '071126d1-6d02-48b7-a4c8-4d2ede320560'
const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const MODEL = 'doubao-seed-1.6-250615'

async function test() {
  console.log('测试火山引擎 API...')
  
  try {
    const response = await axios.post(
      `${BASE_URL}/responses`,
      {
        model: MODEL,
        input: [
          {
            role: 'user',
            content: 'TypeScript 编程语言'
          }
        ],
        tools: [{ type: 'web_search' }]
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000  // 60秒超时
      }
    )
    
    console.log('状态:', response.status)
    
    let results = 0
    if (response.data?.output) {
      for (const item of response.data.output) {
        if (item.type === 'message' && item.content) {
          for (const content of item.content) {
            if (content.type === 'output_text' && content.annotations) {
              results = content.annotations.filter((a: any) => a.type === 'url_citation').length
            }
          }
        }
      }
    }
    
    console.log('搜索结果数:', results)
    console.log('✓ 成功')
  } catch (error: any) {
    console.log('✗ 失败:', error.message)
  }
}

test()
