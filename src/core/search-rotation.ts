import { Config, SearchConfig } from '../types'
import { debug } from '../utils/logger'

interface ModelRotationState {
  currentIndex: number
  models: string[]
  lastFailureTime: number
  failureCount: number
}

const modelRotationStates = new Map<string, ModelRotationState>()

function getModelRotationState(key: string, models: string[]): ModelRotationState {
  if (!modelRotationStates.has(key)) {
    modelRotationStates.set(key, {
      currentIndex: 0,
      models,
      lastFailureTime: 0,
      failureCount: 0
    })
  }

  return modelRotationStates.get(key)!
}

export function getNextVolcengineModel(config: Config, searchConfig: SearchConfig): string {
  if (searchConfig.volcengine?.models && searchConfig.volcengine.models.length > 0) {
    const state = getModelRotationState('volcengine', searchConfig.volcengine.models)
    const now = Date.now()

    if (state.lastFailureTime > 0 && now - state.lastFailureTime < 60000) {
      state.currentIndex = (state.currentIndex + 1) % state.models.length
      debug(
        config,
        `模型轮询: 上次失败，切换到模型 ${state.models[state.currentIndex]}`,
        'Search-Volcengine',
        'info'
      )
    }

    const model = state.models[state.currentIndex]
    state.lastFailureTime = 0
    return model
  }

  if (searchConfig.volcengine?.useAiModel !== false && config.ai?.model) {
    return config.ai.model
  }

  const defaultModels = [
    'doubao-seed-1-6-lite-251015',
    'doubao-seed-1-6-flash-250828'
  ]
  const state = getModelRotationState('volcengine-default', defaultModels)
  const model = defaultModels[state.currentIndex]
  state.currentIndex = (state.currentIndex + 1) % defaultModels.length

  return model
}

export function markVolcengineModelFailure(
  config: Config,
  searchConfig: SearchConfig,
  model: string
): void {
  const key = searchConfig.volcengine?.models ? 'volcengine' : 'volcengine-default'
  const state = modelRotationStates.get(key)

  if (state) {
    state.lastFailureTime = Date.now()
    state.failureCount++
    state.currentIndex = (state.currentIndex + 1) % state.models.length

    debug(
      config,
      `模型 ${model} 失败，切换到下一个模型 ${state.models[state.currentIndex]} (失败次数: ${state.failureCount})`,
      'Search-Volcengine',
      'info'
    )
  }
}

export function clearSearchRotationStates(): void {
  modelRotationStates.clear()
}