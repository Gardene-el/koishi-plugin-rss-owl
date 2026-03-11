## 第四阶段核心模块收敛记录

### 开发概述

本次调整完成了第四阶段剩余核心工作：

1. 拆分 `src/core/item-processor.ts`
2. 延续并完成 `feeder` 拆分后的验证闭环
3. 更新 `src/constants.ts` 中 `rsso` 主帮助文案，使其与当前命令系统一致

当前阶段按约定未处理 `parser.ts` 与 `rsso.html` 的实现细节扩展，只保留帮助导航层面的更新。

### 实现细节

#### 1. item-processor 拆分

- 新增 `src/core/item-processor-runtime.ts`
  - 收敛文本标准化、图片去重、HTML 渲染、视频提取、AI 摘要 HTML 注入等运行时 helper
- 新增 `src/core/item-processor-template.ts`
  - 收敛模板分发与 `custom` / `content` / `default` / `only media` / `link` 等模板处理逻辑
- 重写 `src/core/item-processor.ts`
  - 主文件仅保留 `RssItemProcessor` 类入口、依赖封装、`parseRssItem()` 主流程协调

#### 2. rsso 帮助文案更新

- 将旧的 `-l/-r/-f/-p` 主线帮助改为当前真实命令体系：
  - `rsso`
  - `rsso.list`
  - `rsso.remove`
  - `rsso.pull`
  - `rsso.follow`
  - `rsso.edit`
  - `rsso.cache`
  - `rsso.queue`
  - `rsso.html`
  - `rsso.ask`
  - `rsso.watch`
- 保留旧选项迁移提示，避免用户无感切换失败

### 修改文件列表

- `src/core/item-processor.ts`
- `src/core/item-processor-runtime.ts`
- `src/core/item-processor-template.ts`
- `src/constants.ts`
- `docs/2026-03-11-phase-4-core-refactor.md`

### 测试情况

- `diagnostics`：通过
- `node ./node_modules/typescript/bin/tsc -p tsconfig.json`：通过
- `node ./node_modules/jest/bin/jest.js --runInBand tests/unit/item-processor.test.ts`：通过
- `node ./node_modules/jest/bin/jest.js --runInBand tests/unit/feeder.test.ts`：通过
- `git diff --check`：通过

### 遇到的问题和解决方案

1. **大块 patch 多次命中旧上下文失败**
   - 改为“先新增 helper 文件，再删除重建主文件，再单独更新帮助文案”的顺序，避免 `Invalid Context`
2. **Cheerio 回调节点类型过宽导致 TypeScript 报错**
   - 对 `img/video` 回调参数做最小显式类型收窄，保持运行时行为不变

### 后续优化建议

1. 若后续继续优化，可补充 `item-processor` 更细粒度单测，覆盖 AI 摘要注入与图片渲染模板分支
2. 若准备对外发布，可在下一次提交流程中决定是否一并纳入本阶段 `docs` 文档