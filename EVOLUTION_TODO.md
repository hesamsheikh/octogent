# Octogent 演进执行清单（四阶段）

> 依据：规划方案已经维护者确认。四个拍板点：归档保留期默认 72h；未合并 worktree 永不自动删；
> 3D 页第一版用 CSS 3D；**3D 进度页放导航第 1 位，现有页面顺延为 2-9**。
> 本文件不纳入任何 commit，去留由维护者决定。

## 操作规范（必须遵守）

- **执行顺序**：按阶段与任务编号顺序，不跳步；每任务独立提交，conventional commits，测试先行（修 bug 先写复现，新功能先写行为测试）。
- **Git 红线**：禁止 force push、禁止改写历史（回退只用 revert）、只在 main 工作、只推 origin main（凭据已配置 credential store，直接 `git push`）。
- **阶段门禁**：每阶段收尾 `pnpm lint && pnpm test && pnpm build` 全绿后推送，并重启服务交付验收（重启方式：kill octogent 进程，守护脚本 3 秒内以新构建拉起；阶段 4.3 完成后改用 systemd）。
- **失败处理**：单任务连续 2 次修复不过 → revert 回退、记录原因、继续后续任务；跳过任务达 3 个则停止并报告。禁止删测试/加 skip/改断言为恒真来换绿。
- **i18n**：一切用户可见文案走 `t()`，en 与 zh-CN 同时新增（i18nParity 测试会拦截漂移）；沿用既有词汇：触手/工作台/停滞/待审阅/已完成。
- **边界**：不升级/新增依赖（three.js 明确排除）；不动 `.octogent/` 运行时状态与 agent 提示词（prompts/、deckRoutes 内嵌指令）；文档改动 en 与 docs/zh-CN 同步。
- **服务常开**：验收期间不长时间停服；任何超过 1 分钟的中断需先向维护者说明。

---

## 阶段 1：Agent 生命周期闭环

### 1.1 域类型扩展
- `packages/core/src/domain/terminal.ts`：生命周期增加 `awaiting-review`（完成但分支未合并）与 `completed`；终端记录增加 `completedAt`、`completionSummary`（结构见 1.3）。
- 所有 switch/映射穷尽处理（typecheck 兜底）；i18n 词条：`待审阅` / `已完成`（en: Awaiting review / Completed）。
- 测试：类型层 + parity。

### 1.2 完成判定（Stop hook 驱动）
- Stop hook 处理链中触发完成评估：
  - worktree 模式：git 工作区干净 && 相对基线有新提交 → 分支已合并入基线 ⇒ `completed`；未合并 ⇒ `awaiting-review`。
  - shared 模式：收到 Stop 即 `completed`（汇报卡标注 shared，无 git 断言）。
- gitClient 按需补只读查询：isClean / aheadCount / isMergedInto（有现成基础于 gitOperations/worktreeManager）。
- 与 stalled 互斥：进入 completed/awaiting-review 后停止停滞检测标记；广播 lifecycle-changed。
- 测试：fake git client 覆盖四条路径（干净已合并/干净未合并/有未提交改动不判完成/shared）。

### 1.3 完成汇报卡（数据层）
- `buildCompletionSummary(terminal)`：{ 任务首行(initialPrompt 第一行), commits[{hash,message}], 文件数, ±行数, 分支名, merged 布尔, durationMs, workspaceMode }。纯 git 事实，不跑测试、不做 AI 总结。
- 存入注册表并随 terminal-snapshots 暴露。测试先行（纯函数 + fake git）。

### 1.4 完成态 UI
- 状态徽章：待审阅（⚠ 醒目）/ 已完成（✓）；agent 卡片展开完成小结；触发既有 `terminalCompletionSound`。
- 「已完成」折叠分组：completed 的 agent 自动收进分组，不占画布主区（视觉层清理）。
- 测试：组件渲染断言（renderWithLocale 钉 en）。

### 1.5 归档机制
- 注册表增 `archivedAt`；后台扫描器（仿 stall detector：setInterval + unref，每小时）：completed/stopped/exited 且 lifecycleUpdatedAt 超过保留期 → 归档。保留期 `OCTOGENT_TERMINAL_RETENTION_HOURS`，默认 72。
- 归档语义：移出活跃快照（默认不返回，`?includeArchived=1` 可查）；转录与完成小结保留，仍可在「对话」页查看。
- CLI：`octogent terminal archive <id>` / `--all-completed`；`terminal list --archived`。
- 测试：时钟注入覆盖到期/未到期/状态过滤。

### 1.6 worktree GC（硬性底线：未合并永不自动删）
- 归档触发时：workspaceMode=worktree 且分支已合并 → 回收 worktree + 分支（复用 removeTentacleWorktree）；未合并 → 保留并维持 awaiting-review 醒目标记。
- CLI：`octogent worktree gc [--dry-run]`：列出/回收所有「已归档且已合并」的 worktree。
- 测试中对"未合并被删"写显式反断言；prune 与 gc 的区别写入 CLI 文档。

### 1.7 阶段收尾
- 文档：docs/reference/cli.md、api.md、runtime-and-api.md（en + zh-CN 同步）新增状态、归档、GC、环境变量；CHANGELOG。
- 门禁 → 推送 → 重启服务 → 请维护者验收（验收脚本：派一个极简任务跑完，观察 完成识别→汇报卡→折叠→(模拟到期)归档→GC 全链路）。

---

## 阶段 2：channel + swarm 实测（不改产品代码）

### 2.1 channel 双终端实测
- 起 A（协调者）/B（工人）两个极简终端；A→B 发送，验证：空闲时注入、注入格式、`--from` 署名、API 列表一致性、重启后丢失边界。
- 记录 UI 是否有频道消息呈现面（疑似没有 → 记为改进项，不实现）。

### 2.2 swarm 实测
- 建 tentacle + 3 条极简 todo → `POST /api/deck/tentacles/:id/swarm` → 验证：父协调者终端生成、worker 分支与 parentTerminalId 层级、channel 回报、todo 勾选闭环、阶段 1 新状态在多层结构下的表现。
- 任务内容最小化以控制额度消耗。

### 2.3 实测报告
- 输出缺陷清单与层级结构实录（存 scratchpad），作为阶段 3 布局引擎的真实测试样例。发现的阻断性缺陷经维护者确认后修复，非阻断只记录。

---

## 阶段 3：3D 工作流进度页（导航第 1 位）

### 3.1 布局引擎（纯逻辑，测试先行）
- `apps/web/src/app/flow/`：`buildFlowLayout(tentacles, terminals)` → 节点{id,type,x,y,z}与边；X=层级（octoboss→触手→agent，parentTerminalId 链），Z=深度平面；`project(point, camera)` 统一投影函数输出屏幕坐标。
- 用阶段 2 的层级实录作测试样例；空态/单层/多层/孤儿节点全覆盖。

### 3.2 FlowPrimaryView 渲染
- CSS 3D（perspective + preserve-3d + translate3d）渲染像素章鱼与 agent 小节点；agent 节点在所属章鱼前方扇形倾斜环绕（Z 更靠近观察者一档）。
- 连线：SVG 用投影后的 2D 坐标绘制，复用现有流光样式；节点与连线同源于布局引擎坐标，规避两套坐标系错位。
- 交互：拖拽平移、滚轮缩放（camera 状态驱动投影）。
- 样式独立 `src/styles/flow-view.css`，跟随现有 console 主题 tokens。

### 3.3 悬停卡
- 悬停显示小卡（约 240px）：名称、状态徽章、todo 进度条（todoDone/todoTotal，todoItems 摘要）、当前工具、最近活动；agent 节点显示任务首行 + 完成小结（阶段 1 数据）。
- 单击=钉住卡片；卡片内显式「打开终端」按钮跳转代理页并聚焦该终端（App 提供跳转回调）。**不出现任何自动展开的大窗口。**

### 3.4 实时性
- 订阅 terminal-events（state/lifecycle/deck-changed）增量更新；免刷新出现/变色/收入完成组。

### 3.5 导航重排（涟漪面最大的任务，单独提交）
- 新页置于第 1 位（快捷键 1，默认落地页），现有 1-8 顺延为 2-9；`PRIMARY_NAV_ITEMS`/`PrimaryNavIndex`/`PRIMARY_NAV_MAX` 更新。
- **清扫硬编码索引**：App.tsx/PrimaryViewRouter 等处的 `activePrimaryNav === 2` 类魔法数字改为命名常量或视图 id 映射（此重构为本任务必要范围）。
- **持久化迁移**：ui-state 增 `navSchemaVersion`；旧快照（无版本号）读入时 activePrimaryNav 整体 +1（clamp 到上限）并升版本，写测试覆盖新旧快照。
- 全量更新受影响测试（"[3] Activity"→"[4] Activity" 等）；i18n：`web.nav.flow`：进度 / Flow。

### 3.6 阶段收尾
- 文档（README 截图区暂不动，docs 两语言补新页说明）、CHANGELOG、门禁、推送、重启，交维护者验收（重点验收：悬停卡信息密度、层级铺开观感、性能）。

---

## 阶段 4：稳定性与安全

### 4.1 用量数据源切换
- `OCTOGENT_CLAUDE_USAGE_SOURCE=auto|oauth|cli|off`，默认 auto：OAuth（readClaudeOauthUsageSnapshot）优先，失败且未禁用时回退 CLI PTY 探测；off 时面板显示不可用。测试覆盖优先级与回退。

### 4.2 LAN 鉴权
- `OCTOGENT_ACCESS_TOKEN`；开启远程访问且未设置时启动自动生成并随局域网地址打印。
- 非回环请求（HTTP + WS upgrade）校验：header `X-Octogent-Token` 或首次 `?token=` → 下发 httpOnly SameSite=Lax cookie，后续走 cookie；回环全豁免（CLI 与本机不受影响）。
- security.ts 现有 host/origin 检查保留；测试：security 单测 + 集成（带/不带 token 的远程模拟）。

### 4.3 systemd 常驻
- `examples/octogent.service`（user unit）+ 文档（含 loginctl enable-linger 说明）；部署后停用会话级守护脚本（touch STOP-OCTOGENT）。

### 4.4 健康端点
- `GET /api/health`：{ status, uptime, version, eventLoopDelayP95(perf_hooks.monitorEventLoopDelay), ptySessions, terminals 按状态计数, wsClients }。回环免鉴权（供守护/监控轮询）。测试。

### 4.5 阶段收尾
- 文档两语言、CHANGELOG、门禁、推送、systemd 切换验证（kill 进程自动复活 + 健康端点自检）。

---

## 明确不做

- 不引入 three.js/WebGL（CSS 3D 不满足观感时另行评估，不自行升级）。
- 不删除/替换现有代理页——顺延保留，是否淘汰由维护者日后决定。
- 未合并 worktree 的任何自动销毁路径。
- AI 生成式完成总结（只用 git 事实）。
- 不发版、不打 tag、不动上游 remote。

## 最终报告要求（每阶段）

基线与结束 commit、任务状态表（完成/跳过+原因）、门禁输出摘要、推送结果、发现但未处理的问题清单。
