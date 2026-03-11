import { BasicConfig, Config, rssArg } from '../types'

export type ResendUpdatedContentMode = NonNullable<BasicConfig['resendUpdatedContent'] | BasicConfig['resendUpdataContent']>

type BasicAliasShape = Partial<BasicConfig> & Record<string, any>
type ArgAliasShape = Partial<rssArg> & Record<string, any>

export function normalizeBasicConfig<T extends BasicAliasShape | undefined>(basic?: T): T & BasicAliasShape {
  const normalized = { ...(basic || {}) } as BasicAliasShape
  const mergeVideo = normalized.mergeVideo ?? normalized.margeVideo
  const resendUpdatedContent = normalized.resendUpdatedContent ?? normalized.resendUpdataContent

  if (mergeVideo !== undefined) {
    normalized.mergeVideo = mergeVideo
    normalized.margeVideo = mergeVideo
  }

  if (resendUpdatedContent !== undefined) {
    normalized.resendUpdatedContent = resendUpdatedContent
    normalized.resendUpdataContent = resendUpdatedContent
  }

  return normalized as T & BasicAliasShape
}

export function normalizeSubscriptionArg<T extends ArgAliasShape | undefined>(arg?: T): T & ArgAliasShape {
  const normalized = { ...(arg || {}) } as ArgAliasShape
  const nextUpdateTime = getNextUpdateTime(normalized)

  if (nextUpdateTime !== undefined) {
    setNextUpdateTime(normalized, nextUpdateTime)
  }

  return normalized as T & ArgAliasShape
}

export function getRuntimeBasicConfig(config: Config): BasicAliasShape {
  return normalizeBasicConfig(config.basic)
}

export function getResendUpdatedContent(config: Config): ResendUpdatedContentMode {
  const basic = getRuntimeBasicConfig(config)
  return basic.resendUpdatedContent ?? 'disable'
}

export function shouldMergeVideo(config: Config): boolean {
  const basic = getRuntimeBasicConfig(config)
  return basic.mergeVideo === true
}

export function getNextUpdateTime(arg?: ArgAliasShape): number | undefined {
  const value = arg?.nextUpdateTime ?? arg?.nextUpdataTime
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function setNextUpdateTime(target: ArgAliasShape, nextUpdateTime?: number): void {
  if (nextUpdateTime === undefined) {
    delete target.nextUpdateTime
    delete target.nextUpdataTime
    return
  }

  target.nextUpdateTime = nextUpdateTime
  target.nextUpdataTime = nextUpdateTime
}