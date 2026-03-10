export interface SearchResult {
  title: string
  url: string
  snippet?: string
  content?: string
  score?: number
  publishedDate?: string
  source?: string
}

export interface SearchResponse {
  success: boolean
  results: SearchResult[]
  query: string
  engine: string
  model?: string
  error?: string
}

export interface TavilyResponse {
  answer?: string
  query: string
  results: Array<{
    title: string
    url: string
    content: string
    score: number
    published_date?: string
  }>
}

export interface SearxngResponse {
  query: string
  results: Array<{
    title: string
    url: string
    content: string
    snippet?: string
    engine?: string
    score?: number
  }>
}