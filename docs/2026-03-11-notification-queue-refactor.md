## notification-queue 拆分记录

### 开发概述

本次调整聚焦 `src/core/notification-queue.ts` 的结构收敛，在不改变对外 API 的前提下，将过重的队列管理器拆为更清晰的职责层。

目标如下：

1. 保留 `NotificationQueueManager` 的公开调用方式不变
2. 保留 `src/core/notification-queue` 的类型导出兼容
3. 将类型、存储、发送/降级、重试策略从主文件中下沉
4. 完成语法检查与最小必要回归验证

### 实现细节

#### 1. 类型下沉

- 新增 `src/core/notification-queue-types.ts`
- 抽出：
  - `QueueStatus`
  - `QueueTaskContent`
  - `QueueTask`
  - `NewQueueTask`
  - `QueueStats`

#### 2. 重试策略下沉

- 新增 `src/core/notification-queue-retry.ts`
- 收敛：
  - `DEFAULT_QUEUE_BACKOFF_DELAYS`
  - `isFatalQueueError()`
  - `getRetryDelaySeconds()`

#### 3. 数据库存取职责下沉

- 新增 `src/core/notification-queue-store.ts`
- 收敛数据库相关操作：
  - 创建任务
  - 获取待处理任务
  - 标记成功 / 重试 / 失败
  - 降级后回写任务
  - 获取统计
  - 重置失败任务
  - 清理旧成功任务

#### 4. 发送与降级职责下沉

- 新增 `src/core/notification-queue-sender.ts`
- 收敛：
  - 消息发送
  - OneBot `1200` 媒体错误识别
  - 视频消息降级
  - 成功消息缓存

#### 5. facade 保持兼容

- 更新 `src/core/notification-queue.ts`
- 主文件当前只保留：
  - `NotificationQueueManager` 对外入口
  - 队列处理主流程协调
  - 日志上下文拼装
  - 对私有兼容点 `isFatalError()` / `downgradeMessage()` 的保留

### 修改文件列表

- `src/core/notification-queue.ts`
- `src/core/notification-queue-types.ts`
- `src/core/notification-queue-retry.ts`
- `src/core/notification-queue-store.ts`
- `src/core/notification-queue-sender.ts`
- `docs/2026-03-11-notification-queue-refactor.md`

### 测试情况

- `diagnostics`：通过
- `node ./node_modules/typescript/bin/tsc -p tsconfig.json`：通过
- `node ./node_modules/jest/bin/jest.js --runInBand tests/unit/notification-queue.test.ts`：通过
- `node ./node_modules/jest/bin/jest.js --runInBand tests/unit/feeder.test.ts`：通过
- `git diff --check`：通过

### 遇到的问题和解决方案

1. **测试直接访问私有方法与内部状态**
   - 保留 `NotificationQueueManager` 中的 `isFatalError()`、`downgradeMessage()` 与 `processing` 兼容点，内部再委托给拆出的 helper。
2. **主文件职责过重但又不能破坏使用点**
   - 采用 facade/orchestration 方式，仅下沉可独立职责，避免改动 `src/index.ts`、`src/core/feeder.ts`、命令管理层的现有调用方式。

### 后续优化建议

1. 若后续继续收敛，可为 `notification-queue-store.ts` 增加更细粒度单测，减少对 manager 私有行为断言的耦合。
2. 若未来要继续处理结构债，下一优先级仍建议回到 `parser.ts`，但按当前边界可继续暂缓。