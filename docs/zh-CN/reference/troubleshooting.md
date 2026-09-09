# 故障排查

## `pnpm test` 因浏览器 API 报错

确认在仓库根目录安装了工作区依赖：

```bash
pnpm install
```

## 包解析出错

从仓库根目录运行安装，而不是在子包里。

## Node 版本过旧

使用 Node.js `22+`。

## 终端启动失败

检查你的 shell 环境可用且可执行。

如果启动失败并提示 `Terminal session limit reached`，说明 Octogent 已达到配置的活动 PTY 会话数上限。用 `octogent terminal stop <terminal-id>` 停掉不用的终端，或用 `octogent terminal prune` 清理不活跃的记录。默认上限是 32；在启动 Octogent 前把 `OCTOGENT_MAX_TERMINAL_SESSIONS` 设为正整数即可调整。

## 工作代理一直没有收到初始提示词

Octogent 在 Claude 或 Codex 上报 `SessionStart` 时发送 `--initial-prompt`；如果就绪信号一直未到，则在启动命令发出 15 秒后兜底发送。`UserPromptSubmit` 表示投递已确认。如果已收到 `SessionStart`，但发送后 10 秒内没有收到确认，Octogent 只会重试一次粘贴和回车。未收到 `SessionStart` 的代理不会重试，因为钩子缺失时无法判断提示词是丢失了还是已经送达。

重试后再过 10 秒仍未确认，终端快照和 `octogent terminal list` 会显示 `reason=initial prompt not acknowledged`。生命周期保持 `running`，后续由常规停滞检测处理；迟到的确认会清除此原因。用 `OCTOGENT_VERBOSE_LOGS=1` 启动 API，可查看钩子到达记录以及 `initial-prompt retry` / `initial-prompt not acknowledged after retry` 日志。检查工作代理的终端是否卡在启动、更新、信任或登录提示，解决后再重新发送任务。重发前先检查终端和日志，避免重复执行已经开始的工作。

## 工作树终端创建失败

确认：

- `git --version` 可用
- 工作区是一个 git 仓库
- 当前用户能在 `.octogent/worktrees/` 下创建工作树

## GitHub 摘要不可用

确认：

```bash
gh auth status
```

## 监控刷新失败

确认你的 X Bearer Token 与 API 访问权限。

## 工作代理的会话在第一轮结束五分钟后关闭

旧行为会在共享模式工作代理的第一次 Stop hook 后标记 `completed` 并释放 PTY 保活。没有浏览器连接时，默认五分钟空闲宽限期结束便关闭会话（`session_close`），后续通道消息因此无法投递。

通过 `--initial-prompt` 创建的工作代理现在默认在轮次之间保活，即使共享模式已标记完成。工作树模式的 `completed` 判定（工作已证实合并）仍会释放保活，`awaiting-review` 保留豁免。如果仍出现旧现象，请在重启 Octogent 前取消 `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN=1`；该开关会恢复旧的释放行为。`OCTOGENT_TERMINAL_IDLE_GRACE_MS` 控制释放后的宽限期。

工作结束后，用 `octogent terminal stop <terminal-id>` 立即关闭工作代理，或用 `octogent terminal archive <terminal-id>` 归档符合条件的空闲工作代理并释放保活。保留期扫描会在 `OCTOGENT_TERMINAL_RETENTION_HOURS` 之后归档符合条件的空闲工作代理。PTY 仍开着的工作代理——不管忙不忙——都不会被下一批派发的清理触碰：编排方可能还要通过 channel 继续用它。

## 消息在重启后消失

这是预期行为。通道消息只存在内存中，不会跨 API 重启持久化。

## 正在忙的终端被标成 `stalled`，转录也不再增长

Octogent 的转录（`state/transcripts/<terminal>.jsonl`）记录的是状态**变化**（idle → processing 及其反向），以及代理 PreToolUse 钩子上报的每次工具调用（`tool_use` 事件）。因此一轮很长的任务在转录里表现为一串 `tool_use` 事件，而不是反复的 `processing` 行。停滞检测所认的"活动"包括提交 prompt、工具调用和 PTY 输出（每几秒记一次），所以肉眼可见在干活的代理不会被判 `stalled`；这个判定只留给活着却在 `OCTOGENT_TERMINAL_STALL_MS` 内毫无输出的 PTY。

如果代理明明在干活却仍被判 stalled，检查它的钩子是否到达了 API：用 `OCTOGENT_VERBOSE_LOGS=1` 启动 API，代理动作时应能看到 `[Hook] Received hook` 日志。Claude 的钩子在 `<workspace>/.claude/settings.json`，Codex 的在用户层 `$CODEX_HOME/hooks.json`。

## `channel send` 提示消息已排队

目标代理正忙时这就是正常回应。channel 消息只在目标会话空闲（由钩子和输出检测共同判断）时注入；在此之前它留在队列里，`octogent channel list <terminal-id>` 会显示 `status=pending`，代理当前一轮结束后自动投递。注意 `channel list` 只知道发给当前正在运行的这个 API 进程的消息。

## 协调者一直等不到工作代理的答复

工作代理的最终回答在它的 Stop 钩子触发时被保存，但不会推送给派发它的人；协调者如果本身不是 Octogent 终端，也收不到 channel 消息。用 `octogent terminal wait <terminal-id> [...]` 阻塞到工作代理结束并打印回答，或随时用 `octogent terminal result <terminal-id>` 读取；脚本用 `--json`。两条命令都是只读的，对任何近期版本的运行中服务都有效。

## 终端能撑过页面刷新，却撑不过服务重启

这同样是预期行为。PTY 会话可以在重连窗口内存活，但不会在 API 重启后存活。

重启后，之前持久化为 running 的终端在 Octogent 无法接回内存中的 PTY 会话时会被标记为 `stale`。用 `octogent terminal list` 查看生命周期状态，用 `octogent terminal stop <terminal-id>` 或 `octogent terminal kill <terminal-id>` 处理记录中的进程，用 `octogent terminal prune` 从 UI 中移除 stale、stopped 或 exited 的记录。

> 本文件是 [../../reference/troubleshooting.md](../../reference/troubleshooting.md) 的中文翻译版本。如有歧义，以英文原文为准。
