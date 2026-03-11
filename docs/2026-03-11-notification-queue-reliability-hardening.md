# Notification Queue Reliability Hardening

## 1. 开发概述

本轮围绕 RSS 主链路的通知队列稳定性进行了三轮收敛，目标是先保证主要功能可用性，而不是继续扩展 HTML 解析能力。

重点改进：

1. 队列可靠性增强：补充最大重试上限与入队幂等去重。
2. 运行边界收紧：新增 queue 配置项并统一运行时 clamp、错误分类与降级判断。
3. 恢复与测试维护性：补强重启恢复边界，降低测试对私有实现的耦合。

## 2. 实现细节

### 2.1 队列可靠性

- 在 `src/core/notification-queue-store.ts` 中增加按 `subscribeId + uid + guildId + platform` 的应用层幂等去重。
- 在 `src/core/notification-queue.ts` 中增加 `maxRetries` 处理逻辑，超过上限后直接落为 `FAILED`。
- 在 `src/core/feeder.ts` 中使用更稳定的队列 `uid`：优先 `link`，其次 `guid`，最后回退到 `getLastContent()` 序列化结果。

### 2.2 运行边界与错误分类

- 在 `src/types.ts` 与 `src/config.ts` 中新增 `queue` 配置组：
  - `batchSize`
  - `maxRetries`
  - `processInterval`
  - `cleanupHours`
- 在 `src/core/notification-queue-retry.ts` 中统一提供：
  - `getQueueRuntimeConfig()`
  - `classifyQueueError()`
  - `isQueueDowngradeError()`
  - `shouldStopRetrying()`
- 在 `src/core/notification-queue-sender.ts` 中收敛 OneBot `1200` 降级判定，并导出 `downgradeQueueMessage()` 供测试和主流程共用。

### 2.3 恢复与可维护性

- 在 `src/core/notification-queue-store.ts` 中新增 `recoverRetryTasksWithoutNextRetryTime()`，修复历史残留的 `RETRY` 脏状态。
- 在 `src/core/notification-queue.ts` 中增加 `ensureRecovered()`，保证首次处理前先执行恢复。
- 新增公开方法 `isProcessing()`，替代测试直接读取私有 `processing` 状态。
- `cleanupSuccessTasks()` 改为优先使用运行时 `queue.cleanupHours`，避免默认参数覆盖配置。

## 3. 修改文件列表

- `src/types.ts`
- `src/config.ts`
- `src/core/notification-queue-types.ts`
- `src/core/notification-queue-retry.ts`
- `src/core/notification-queue-sender.ts`
- `src/core/notification-queue-store.ts`
- `src/core/notification-queue.ts`
- `src/core/feeder.ts`
- `tests/unit/notification-queue.test.ts`
- `tests/unit/feeder.test.ts`

## 4. 测试情况

已执行以下检查：

1. `diagnostics`：无报错
2. `node ./node_modules/typescript/bin/tsc -p tsconfig.json`：`EXIT:0`
3. `node ./node_modules/jest/bin/jest.js --runInBand tests/unit/notification-queue.test.ts`：15/15 通过
4. `node ./node_modules/jest/bin/jest.js --runInBand tests/unit/feeder.test.ts`：41/41 通过
5. `git diff --check`：`EXIT:0`

## 5. 遇到的问题和解决方案

### 问题 1：旧测试强耦合私有实现

旧的 `notification-queue` 测试直接访问私有方法和私有字段，在新增恢复逻辑后容易因内部调用顺序变化而失败。

**解决方案：**

- 改为直接测试 helper 导出与 manager 公开行为。
- 通过内存版 `database` mock 验证状态变化，减少对内部查询顺序的依赖。

### 问题 2：成功任务清理默认值覆盖运行时配置

`cleanupSuccessTasks()` 之前使用了固定默认值 `24`，会绕过新增的 `queue.cleanupHours` 配置。

**解决方案：**

- 将方法签名改为 `olderThanHours?: number`。
- 运行时通过 `olderThanHours ?? this.cleanupHours` 获取最终值。

## 6. 后续优化建议

1. 如后续需要更强幂等保证，可再考虑数据库唯一索引。
2. 若后续要做更细粒度运维能力，可考虑在队列层补充失败原因聚合统计。
3. HTML 解析与网页监控链路按当前决策继续暂缓，待需求明确后再单独设计。
