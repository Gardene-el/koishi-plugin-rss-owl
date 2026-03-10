import { Context } from 'koishi'

import type { Config, TemplateType } from '../types'
import { ensureUrlProtocol } from '../utils/common'
import { getFriendlyErrorMessage } from '../utils/error-handler'
import { buildCommandLogContext, checkAuthority, extractSessionInfo, parseTarget } from './utils'

interface CreateCommandOptions {
  quick?: string
  list?: string
  remove?: string
  removeAll?: boolean
  follow?: string
  followAll?: string
  target?: string
  arg?: string
  template?: TemplateType
  title?: string
  pull?: string
  force?: boolean
  daily?: string
  test?: boolean
}

export interface SubscriptionCreateCommandDeps {
  ctx: Context
  config: Config
  usage: string
  quickList: Array<{ name: string; detail: string; example: string }>
  parseQuickUrl: (url: string) => string
  parsePubDate: (pubDate: any) => Date
  getRssData: (url: string, arg: any) => Promise<any[]>
  parseRssItem: (item: any, arg: any, authorId: string | number) => Promise<string>
  formatArg: (options: Record<string, any>) => any
  mixinArg: (arg: any) => any
  debug: (message: any, name?: string, type?: 'disable' | 'error' | 'info' | 'details', context?: Record<string, any>) => void
}

/**
 * 注册主订阅命令。
 */
export function registerSubscriptionCreateCommand(deps: SubscriptionCreateCommandDeps): void {
  deps.ctx.guild()
    .command('rssowl <url:text>', '订阅 RSS/源')
    .alias('rsso')
    .usage(deps.usage)
    .option('list', '-l [content] 查看订阅列表(详情) [已移至 rsso.list 子命令，使用列表序号]')
    .option('remove', '-r <序号> 删除订阅 [已移至 rsso.remove 子命令，使用列表序号]')
    .option('removeAll', '删除全部订阅 [已移至 rsso.remove --all 子命令]')
    .option('follow', '-f <序号> 关注订阅 [已移至 rsso.follow 子命令，使用列表序号]')
    .option('followAll', '<序号> 在该订阅更新时提醒所有人 [已移至 rsso.follow --all 子命令，使用列表序号]')
    .option('target', '--target <platform:guildId> 跨群订阅（高级权限）')
    .option('arg', '-a <content> 自定义配置')
    .option('template', '-i <content> 消息模板')
    .option('title', '-t <content> 自定义命名')
    .option('pull', '-p <序号> 拉取订阅最新更新 [已移至 rsso.pull 子命令，使用列表序号]')
    .option('force', '强行写入')
    .option('daily', '-d <content>')
    .option('test', '-T 测试')
    .option('quick', '-q [content] 查询快速订阅列表')
    .example('rsso https://hub.slarker.me/qqorw')
    .action(async ({ session, options }, url) => {
      const logContext = buildCommandLogContext(session as any, 'rsso', 'create')
      deps.debug(options, 'options', 'info', logContext)

      const { guildId, platform, authorId: userId, authority } = extractSessionInfo(session as any)
      const botSelfId = session.bot?.selfId

      deps.debug(`${platform}:${userId}:${guildId}, bot:${botSelfId}`, '', 'info', logContext)

      if (options?.quick === '') {
        return '输入 rsso -q [id] 查询详情\n' + deps.quickList.map((v, i) => `${i + 1}.${v.name}`).join('\n')
      }

      if (options?.quick) {
        const currentQuickObj = deps.quickList[parseInt(options.quick) - 1]
        if (!currentQuickObj) return `快速订阅编号不存在: ${options.quick}`
        return `${currentQuickObj.name}\n${currentQuickObj.detail}\n例:rsso -T ${currentQuickObj.example}\n(${deps.parseQuickUrl(currentQuickObj.example)})`
      }

      if (platform.includes('sandbox') && !options.test && url) {
        session.send('沙盒中无法推送更新，但RSS依然会被订阅，建议使用 -T 选项进行测试')
      }

      const rssList = await deps.ctx.database.get(('rssOwl' as any), { platform, guildId })

      if (options?.list === '' || options?.list) return '💡 提示：请使用子命令查看订阅\n\nrsso.list              - 查看所有订阅（显示序号）\nrsso.list 1            - 查看订阅详情\n\n（旧选项 -l 仍可使用，但建议迁移到新命令）'
      if (options?.remove) return '💡 提示：请使用子命令删除订阅\n\nrsso.remove 1           - 删除订阅 #1（使用列表序号）\nrsso.remove --all       - 删除全部订阅\n\n（旧选项 -r 仍可使用，但建议迁移到新命令）'
      if (options?.removeAll) return '💡 提示：请使用子命令删除订阅\n\nrsso.remove --all       - 删除全部订阅\n\n（旧选项仍可使用，但建议迁移到新命令）'
      if (options?.follow) return '💡 提示：请使用子命令关注订阅\n\nrsso.follow 1           - 关注订阅 #1（使用列表序号）\n\n（旧选项 -f 仍可使用，但建议迁移到新命令）'
      if (options?.followAll) return '💡 提示：请使用子命令设置全员提醒\n\nrsso.follow 1 --all     - 设置全员提醒（使用列表序号）\n\n（旧选项仍可使用，但建议迁移到新命令）'
      if (options?.pull) return '💡 提示：请使用子命令拉取订阅\n\nrsso.pull 1             - 拉取订阅 #1 的最新更新（使用列表序号）\n\n（旧选项 -p 仍可使用，但建议迁移到新命令）'
      if (!url) return deps.usage
      if (rssList.find(item => item.url === url)) return '该订阅已存在'

      const rawArg = deps.formatArg(options as Record<string, any>)
      const arg = deps.mixinArg(rawArg)
      let targetPlatform = platform
      let targetGuildId = guildId

      if (options?.target) {
        const authorityCheck = checkAuthority(authority, deps.config.basic.advancedAuthority, `权限不足！当前权限: ${authority}，需要权限: ${deps.config.basic.advancedAuthority} 或以上`)
        if (!authorityCheck.success) return authorityCheck.message

        const parsedTarget = parseTarget(options.target)
        if (!parsedTarget) {
          return '请输入正确的群号，格式为 platform:guildId 或 platform：guildId\n示例: onebot:123456'
        }

        targetPlatform = parsedTarget.platform
        targetGuildId = parsedTarget.guildId

        if (options.test) {
          try {
            await deps.ctx.broadcast([`${targetPlatform}:${targetGuildId}`], '📤 跨群订阅测试消息')
            return `✅ 测试消息已发送到目标群组\n目标: ${targetPlatform}:${targetGuildId}\n\n说明：Bot 可以访问该群组，跨群订阅可以正常工作。\n去掉 --test 选项完成订阅。`
          } catch (error: any) {
            return `❌ 无法发送到目标群组\n目标: ${targetPlatform}:${targetGuildId}\n错误: ${error.message}\n\n请确认：\n1. Bot 是否在该群组中\n2. 群组ID 是否正确\n3. 平台名称是否正确（如 onebot, telegram 等）`
          }
        }
      }

      let title = options?.title || ''

      try {
        url = deps.parseQuickUrl(url)
        const rssItemList = await deps.getRssData(ensureUrlProtocol(url), arg)

        if (options.test) {
          const testItem = rssItemList[0]
          if (!testItem) return '未获取到数据'

          const testArg = { ...arg, url: title || testItem.rss.channel.title, title: title || testItem.rss.channel.title }
          if (!testArg.template) testArg.template = deps.config.basic.defaultTemplate
          return deps.parseRssItem(testItem, testArg, userId)
        }

        if (!title) {
          title = rssItemList[0]?.rss.channel.title
          if (!title) return '无法获取标题，请使用 -t 指定标题'
        }

        const lastPubDate = deps.parsePubDate(rssItemList[0]?.pubDate)
        const rssItem: any = {
          url,
          platform: targetPlatform,
          guildId: targetGuildId,
          author: botSelfId,
          rssId: rssItemList[0]?.rss?.channel?.title ? rssItemList[0].rss.channel.title : title,
          arg: rawArg,
          title,
          lastPubDate,
          lastContent: [],
          followers: []
        }

        if (options.force) {
          const forceCheck = checkAuthority(authority, deps.config.basic.authority, `权限不足！当前权限: ${authority}，需要权限: ${deps.config.basic.authority} 或以上`)
          if (!forceCheck.success) return forceCheck.message
        } else if (deps.config.basic.urlDeduplication && rssList.find(item => item.rssId === rssItem.rssId)) {
          return `订阅已存在: ${rssItem.rssId}`
        }

        await deps.ctx.database.create(('rssOwl' as any), rssItem)

        if (deps.config.basic.firstLoad && arg.firstLoad !== false && rssItemList.length > 0) {
          let itemArray = rssItemList.sort((a, b) => deps.parsePubDate(b.pubDate).getTime() - deps.parsePubDate(a.pubDate).getTime())
          if (arg.reverse) itemArray = itemArray.reverse()
          const maxItem = arg.forceLength || 1
          const mergedArg = deps.mixinArg(rssItem.arg)
          const messageList = await Promise.all(itemArray.filter((_, index) => index < maxItem).map(async item => deps.parseRssItem(item, { ...rssItem, ...mergedArg }, rssItem.author)))
          await deps.ctx.broadcast([`${targetPlatform}:${targetGuildId}`], messageList.join(''))
        }

        return `订阅成功: ${title}`
      } catch (error) {
        deps.debug(error, 'add error', 'error', logContext)
        return `订阅失败: ${getFriendlyErrorMessage(error, '添加订阅')}`
      }
    })
}