# API 参考

Octogent 暴露一套本地 HTTP 与 WebSocket API。

API 涉及两类不同的状态：

- 持久化的项目状态，如终端记录、Deck 元数据、UI 状态与转录
- 内存中的运行时状态，如活动 PTY、已接入的 WebSocket、回滚缓冲与通道队列

大多数 HTTP 路由要么读写持久化文件，要么创建运行时记录。WebSocket 路由把客户端接到 API 进程拥有的活动 PTY 会话上。

## 终端

- `GET /api/terminal-snapshots` - 返回供 UI 使用的当前终端列表与快照状态；默认排除已归档记录，传 `?includeArchived=1` 时包含
- `POST /api/terminals` - 创建新的终端会话
- `POST /api/terminals/prune` - 移除生命周期状态为 `stale`、`stopped` 或 `exited` 的终端记录
- `POST /api/terminals/archive-completed` - 归档所有生命周期状态为 `completed` 的终端记录
- `PATCH /api/terminals/:terminalId` - 更新终端元数据，如显示名
- `DELETE /api/terminals/:terminalId` - 移除终端并关闭其活动会话
- `POST /api/terminals/:terminalId/stop` - 停止活动会话或记录中的 stale 进程
- `POST /api/terminals/:terminalId/kill` - 杀死活动会话或记录中的 stale 进程
- `POST /api/terminals/:terminalId/archive` - 归档一条非运行中的终端记录（运行中的终端返回 `409`）；转录与完成摘要等文件保留
- `WS /api/terminals/:terminalId/ws` - 通过 WebSocket 流式传输终端实时 IO

终端快照在已知时包含 `lifecycleState`。支持的生命周期状态为 `registered`、`running`、`stopped`、`exited` 与 `stale`。stale 终端是那些持久化为 running、但启动后无法重新接回活动 Octogent PTY 会话的记录。

创建终端会先登记元数据。只有在提供初始提示词、WebSocket 接入或内部直连监听器启动会话时，PTY 才会立即启动。工作树终端还会在终端记录对外可见之前先创建其工作树。

## Git 与工作树

- `GET /api/tentacles/:tentacleId/git/status` - 读取工作树类触手的 git 状态
- `POST /api/tentacles/:tentacleId/git/commit` - 从触手工作树创建提交
- `POST /api/tentacles/:tentacleId/git/push` - 推送触手分支
- `POST /api/tentacles/:tentacleId/git/sync` - 将触手工作树与其基础分支同步
- `GET /api/tentacles/:tentacleId/git/pr` - 读取触手分支的 Pull Request 信息
- `POST /api/tentacles/:tentacleId/git/pr/merge` - 合并触手的 Pull Request
- `POST /api/worktrees/gc` - 回收所有「已归档且已确证合并」（生命周期状态为 `completed`，或完成摘要标记 `merged: true`）的 worktree 终端对应的 worktree 目录与分支；传 `?dryRun=1` 仅列出候选、不做删除。返回 `dryRun`、`candidates`、`reclaimedWorktreeIds` 与 `failedWorktreeIds`。未合并的工作永不回收。

## Deck 与触手

- `GET /api/deck/skills` - 列出从项目本地 `.claude/skills/<skill>/SKILL.md` 发现的可用 Claude Code 技能
- `GET /api/deck/tentacles` - 列出触手及其元数据、保管库文件与待办进度
- `POST /api/deck/tentacles` - 创建新触手
- `DELETE /api/deck/tentacles/:tentacleId` - 删除触手及其存储的文件
- `PATCH /api/deck/tentacles/:tentacleId/skills` - 更新触手建议的 Claude Code 技能，并重写 `CONTEXT.md` 中的受管块
- `POST /api/deck/tentacles/:tentacleId/todo` - 向 `todo.md` 添加一条待办
- `PATCH /api/deck/tentacles/:tentacleId/todo/toggle` - 将待办标记为完成或未完成
- `PATCH /api/deck/tentacles/:tentacleId/todo/edit` - 编辑待办文本
- `POST /api/deck/tentacles/:tentacleId/todo/delete` - 删除一条待办
- `GET /api/deck/tentacles/:tentacleId/files/:filename` - 读取触手保管库中的一个 markdown 文件
- `POST /api/deck/tentacles/:tentacleId/swarm` - 从未完成的待办项生成工作终端

Deck 路由把 `.octogent/tentacles/<tentacle-id>/` 当作面向代理上下文的唯一事实来源。待办操作按解析出的项索引更新 `todo.md`。集群操作从解析出的未完成待办派生工作代理的任务指派。

## 提示词

- `GET /api/prompts` - 列出可用的提示词模板
- `POST /api/prompts` - 创建用户提示词
- `GET /api/prompts/:promptId` - 读取一条提示词
- `PUT /api/prompts/:promptId` - 更新一条提示词
- `DELETE /api/prompts/:promptId` - 删除一条提示词

## 通道

- `GET /api/channels/:terminalId/messages` - 列出某个终端通道的消息
- `POST /api/channels/:terminalId/messages` - 向某个终端通道发送消息

通道消息在内存中排队。POST 请求体提供 `fromTerminalId` 与 `content`；投递会在目标会话空闲时把待投递消息注入目标终端输入。

## 代码洞察

- `POST /api/code-intel/events` - 记录一条代码洞察事件
- `GET /api/code-intel/events` - 返回存储的代码洞察事件日志

## 钩子

- `POST /api/hooks/:hookName` - 接收来自 Claude Code 钩子的生命周期事件

当前的钩子名称：

- `session-start`
- `user-prompt-submit`
- `pre-tool-use`
- `notification`
- `stop`

## 用量与遥测

- `GET /api/codex/usage` - 返回可用时的 Codex 用量数据
- `GET /api/claude/usage` - 返回可用时的 Claude 用量数据
- `GET /api/github/summary` - 返回 GitHub 摘要与仓库遥测数据
- `GET /api/analytics/usage-heatmap?scope=all|project` - 返回来自 Claude 会话历史的热力图数据

## UI 状态

- `GET /api/ui-state` - 读取当前项目持久化的 UI 状态
- `PATCH /api/ui-state` - 更新持久化的 UI 状态

## 工作区安装

- `GET /api/setup` - 读取当前工作区经核验的首次运行安装状态
- `POST /api/setup/steps/:stepId` - 运行一个安装步骤并返回刷新后的安装快照

## 监控

- `GET /api/monitor/config` - 读取监控配置
- `PATCH /api/monitor/config` - 更新监控配置
- `GET /api/monitor/feed` - 返回当前监控信息流快照
- `POST /api/monitor/refresh` - 强制刷新监控

## 对话

- `GET /api/conversations` - 列出存储的对话
- `DELETE /api/conversations` - 删除全部存储的对话
- `GET /api/conversations/search?q=...` - 按文本搜索对话
- `GET /api/conversations/:sessionId` - 完整读取一条对话
- `GET /api/conversations/:sessionId/export?format=json|md` - 将一条对话导出为 JSON 或 Markdown

## 请求限制与默认值

- JSON 请求体上限为 `1 MiB`
- 非法 JSON 返回 `400`
- 不支持的方法返回 `405`
- 服务器默认绑定回环地址

> 本文件是 [../../reference/api.md](../../reference/api.md) 的中文翻译版本。如有歧义，以英文原文为准。
