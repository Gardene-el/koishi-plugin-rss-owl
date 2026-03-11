# RSS Mainline P0 Hardening

## 1. 开发概述

本轮落地项目评估中的 P0，目标是优先保障 RSS 主链路可用性，并继续暂缓 HTML / 网页监控体验扩展。

本次改动聚焦三件事：

1. 收敛历史命名，改为运行时“规范命名优先 + 旧命名兼容”。
2. 补上 RSS 主链路 integration test，覆盖 feeder 到发送队列的真实回归链路。
3. 在 README 中明确当前产品边界，避免对 HTML 能力给出过高稳定性承诺。

## 2. 实现细节

### 2.1 历史命名兼容层

- 新增 `src/utils/legacy-config.ts`，统一处理：
  - `mergeVideo` / `margeVideo`
  - `resendUpdatedContent` / `resendUpdataContent`
  - `nextUpdateTime` / `nextUpdataTime`
- 在 `src/core/feeder-arg.ts` 中通过 `normalizeBasicConfig()` 与 `normalizeSubscriptionArg()` 收敛合并逻辑。
- 在 `src/core/feeder.ts` 中通过 `getNextUpdateTime()` / `setNextUpdateTime()` 统一 interval 读写，并在持久化时同步写回新旧字段。
- 在 `src/core/feeder-runtime.ts` 中通过 helper 统一读取重发内容策略与视频合并策略，避免散落的历史字段判断。

### 2.2 类型与测试基线收敛

- 在 `src/types.ts` 中补充规范命名字段，同时保留历史字段，保证运行时与测试类型一致。
- `tests/unit/feeder.test.ts` 调整为规范命名基线，并新增历史字段兼容断言。
- `tests/unit/notification-queue.test.ts` 切换到规范命名基线配置。

### 2.3 RSS 主链路集成回归

- 新增 `tests/integration/rss-main-flow.test.ts`。
- 使用内存版 database mock 验证完整主链路：
  - `feeder()` 抓取更新
  - `NotificationQueueManager.addTask()` 入队
  - `processQueue()` 消费
  - `ctx.broadcast()` 实际发送
- 额外断言：
  - 队列状态 `PENDING -> SUCCESS`
  - `nextUpdateTime` / `nextUpdataTime` 同步写回
  - 内容更新去重逻辑生效
  - 视频消息触发 forward 合并

### 2.4 README 边界说明

- 在 `README.md` 中新增“当前稳定性边界”小节。
- 明确：
  - 当前稳定重点是 RSS / Atom / RSSHub 主链路。
  - HTML / 网页监控当前仍属基础能力，暂不作为成熟度承诺重点。
  - 运行时已兼容规范命名，但当前 Koishi Schema / WebUI 仍显示历史字段名。

## 3. 修改文件列表

- `src/utils/legacy-config.ts`
- `src/types.ts`
- `src/core/feeder-arg.ts`
- `src/core/feeder.ts`
- `src/core/feeder-runtime.ts`
- `tests/unit/feeder.test.ts`
- `tests/unit/notification-queue.test.ts`
- `tests/integration/rss-main-flow.test.ts`
- `README.md`

## 4. 测试情况

已执行以下验证：

1. `diagnostics`：本轮代码文件无报错；`README.md` 仍有既有 Markdown 规范告警。
2. `node ./node_modules/typescript/bin/tsc -p tsconfig.json`：`EXIT:0`
3. `node ./node_modules/jest/bin/jest.js --runInBand tests/unit/feeder.test.ts tests/unit/notification-queue.test.ts tests/integration/rss-main-flow.test.ts`：`60/60` 通过
4. `git diff --check`：`EXIT:0`

## 5. 遇到的问题和解决方案

### 问题 1：Schema 仍使用历史字段名

如果直接在 `src/config.ts` 中暴露新旧双字段，Koishi WebUI 很可能出现重复配置项和默认值混乱。

**解决方案：**

- 本轮只做运行时 / 类型 / 测试兼容收敛。
- `src/config.ts` 暂不激进改为双字段。
- README 明确说明“运行时支持新命名，但 WebUI 仍显示旧字段”。

### 问题 2：RSS 主链路缺少黑盒回归

此前主要依赖 unit test，缺少 feeder 到发送队列的完整链路验证。

**解决方案：**

- 新增 integration test。
- 用内存数据库 mock 验证订阅状态持久化、入队、消费和发送结果。

## 6. 后续优化建议

1. 后续如要继续收敛命名，可在合适时机评估 Schema 迁移方案，但应避免破坏现有 WebUI 配置体验。
2. RSS 主链路可继续补更多异常场景集成回归，例如抓取失败、重试恢复、缓存补发等。
3. HTML / 网页监控链路继续按当前决策暂缓，待需求明确后单独设计。