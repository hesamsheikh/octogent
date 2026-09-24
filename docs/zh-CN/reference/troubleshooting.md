# 故障排查

## 诊断服务问题

在项目目录运行 `octogent logs` 查看持久化服务日志，或运行 `octogent logs --follow` 持续跟随。默认文件位于 `~/.octogent/projects/<project-id>/logs/server.log`；Octogent 启动时会打印实际路径。即使终端保持安静，文件仍会保存详细的钩子摘要；文件达到 5 MB 时轮转，并以 `server.log.1` 到 `server.log.3` 保留三代旧日志。

启动前设置 `OCTOGENT_SERVER_LOG=<路径>` 可改用其他位置，设置 `OCTOGENT_SERVER_LOG=off` 可禁用。文件中的局域网 URL 访问令牌会被掩码，钩子请求正文不会被记录。

hub 为所有项目只写一个日志 `~/.octogent/hub/logs/server.log`，每行带 `[<slug>]` 标记；`octogent hub status` 会打印它的路径。

## 端口 8787 被旧的单项目服务器占用

`octogent`、`octogent hub start` 或任何其他会启动 hub 的命令报错 `port 8787 is taken by pid <pid>, a single-project Octogent server for <path>, not a hub`。hub 使用固定端口，好让每个 CLI 都能找到它，而某个单项目服务器先占了这个端口：用 `octogent --standalone` 启动的，或是在 `octogent` 默认改用 hub 之前直接运行 `octogent` 启动的。两种处理方式：

- 停掉那个服务器（在它的终端按 Ctrl-C，或 `kill <pid>`），再启动 hub。停掉它会结束它正在运行的终端，所以先在那个项目里看一眼 `octogent terminal list`。它停下之前，那个项目里的 CLI 命令仍然连它；停下之后会自动改连 hub。
- 或者让它继续运行，给 hub 换个端口：在 shell 配置里设置 `OCTOGENT_HUB_PORT`（例如 `9787`），让 hub 和每个 CLI 用同一个值。

如果提示说 pid 未知，说明端口被某个不是 Octogent 的程序占用；用 `lsof -i :8787` 或 `ss -ltnp 'sport = :8787'` 查看是谁。

## hub 运行的是较旧的构建

在 hub 持续运行期间升级或重新构建了 Octogent 后，命令会打印 `` 警告：hub 运行的是较旧的构建（hub …，CLI …）；等 worker 空闲时执行 `octogent hub restart`。 ``：hub 仍在运行它启动时加载的代码。大部分功能照常可用，但新构建里的修复和新路由要等重启后才生效。等 `octogent hub status` 显示没有运行中或待审阅的终端时，执行 `octogent hub restart`。还有这类终端时重启会被拒绝（它们会随 hub 一起终止）并列出它们；加 `--force` 则照样重启。

如果提示的是"构建与 CLI 不同"而不是"较旧"，说明 CLI 和 hub 来自不同的安装或提交，例如全局安装与开发检出并存；检查 `PATH` 上排在最前的是哪个 `octogent`。工作代理不会打印这条警告（它们的 CLI 直接使用 `OCTOGENT_API_BASE`），所以不会诱使代理自行重启 hub。

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

## 工作代理找不到你的 shell 里有的 python、node 或其他工具

工作代理从干净的基线环境启动，而不是继承启动 Octogent 的那个 shell，因此已激活的 virtualenv、`conda` 环境，或只在那个 shell 里 export 的变量都不会传给它们（见[工作代理的环境](cli.md#工作代理的环境)）。`PATH` 本身会保留，但 `VIRTUAL_ENV` 以及基线之外的变量不会。

- 对整个项目：把变量写进 `<项目>/.octogent/env`，例如 `PATH=$PWD/.venv/bin:$PATH` 与 `VIRTUAL_ENV=$PWD/.venv`。`octogent init` 找到 `.venv/` 或 `venv/` 时会自动写好。每次会话启动都会重新读取，无需重启；被跳过的行可在 `octogent logs` 中看到。
- 对单个工作代理：从当前 shell 传过去，`octogent terminal create --inherit-env PATH,VIRTUAL_ENV ...`。这些值不会持久化，服务重启后请改用 `.octogent/env`。
- 代理自身要用的云服务凭据（例如 Bedrock 用的 `AWS_PROFILE`、Vertex 用的 `GOOGLE_APPLICATION_CREDENTIALS`）同样不在基线里，按同样方式添加。
- 想确认问题出在环境上，可以用 `OCTOGENT_PTY_ENV_MODE=inherit` 启动 Octogent，它会像以前一样复制服务进程的完整环境。

## 工作代理一直没有收到初始提示词

Octogent 在 Claude 或 Codex 上报 `SessionStart` 时发送 `--initial-prompt`；如果就绪信号一直未到，则在启动命令发出 15 秒后兜底发送。`UserPromptSubmit` 表示投递已确认。如果已收到 `SessionStart`，但发送后 10 秒内没有收到确认，Octogent 只会重试一次粘贴和回车。未收到 `SessionStart` 的代理不会重试，因为钩子缺失时无法判断提示词是丢失了还是已经送达。

重试后再过 10 秒仍未确认，终端快照和 `octogent terminal list` 会显示 `reason=initial prompt not acknowledged`。生命周期保持 `running`，后续由常规停滞检测处理；迟到的确认会清除此原因。用 `octogent logs` 查找钩子到达记录以及 `initial-prompt retry` / `initial-prompt not acknowledged after retry` 日志；只有希望终端也显示这些信息时，才需要在启动前设置 `OCTOGENT_VERBOSE_LOGS=1`。检查工作代理的终端是否卡在启动、更新、信任或登录提示，解决后再重新发送任务。重发前先检查终端和日志，避免重复执行已经开始的工作。

## Claude 工作代理刚启动就卡住（读取工作目录之外的文件）

Claude Code 会在会话首次读取工作目录之外的路径时显示一次性对话框 `Read outside the working directories`。Octogent 会把 `<workspace>/.octogent/tentacles` 加入 Claude 工作树终端的工作目录，因此读取其中的任务简报和 tentacle 文档不会触发该对话框；读取其他外部路径仍可能触发它。

在任意交互式 `claude` 会话中回答一次该对话框，即可为当前用户确定此选项；Claude 会把选择保存在用户设置中。如果曾选择阻止读取，对话框本身会提示：从用户设置中移除 `permissions.blockReadsOutsideWorkingDirectories` 即可撤销 Block 选项。

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

如果代理明明在干活却仍被判 stalled，检查它的钩子是否到达了 API：运行 `octogent logs --follow`，代理动作时应能看到 `[Hook] Received hook` 日志。Claude 的钩子在 `<workspace>/.claude/settings.json`，Codex 的在用户层 `$CODEX_HOME/hooks.json`。

## `channel send` 提示消息已排队

目标代理正忙时这就是正常回应。channel 消息只在目标会话空闲（由钩子和输出检测共同判断）时注入；在此之前它留在队列里，`octogent channel list <terminal-id>` 会显示 `status=pending`，代理当前一轮结束后自动投递。注意 `channel list` 只知道发给当前正在运行的这个 API 进程的消息。

## channel 消息显示已投递，代理却没有动静

“已投递”只表示文字写进了目标终端，不代表代理收到了；代理 TUI 里的对话框（比如用量上限或切换模型提示）可能吞掉粘贴内容和回车。运行 `octogent channel list <terminal-id>` 看状态：

- `confirmed`：投递后代理提交过提示词，消息已到手；去它的终端看它正在怎么处理。
- `delivered (awaiting receipt)`：还没有回执。Octogent 每次投递等 10 秒，刚投递的消息可能还会重试；从未发来任何钩子的代理会一直保持未确认，因为那里没有东西能确认。
- `failed: not acknowledged`：Octogent 粘贴了两次，两次都没有回执。处于 `running` 的目标在 `octogent terminal list` 中还会显示 `reason=channel message not acknowledged`，`octogent logs` 里有对应的 `[Channel] ... not acknowledged` 日志。

然后看代理界面上显示的是什么，直接作答：

```bash
octogent terminal screen <terminal-id> --lines 40
octogent terminal input <terminal-id> --keys esc
```

对话框消失后再发一次消息；代理接受提示词后这条原因会自动清除。重发前先看屏幕：如果消息其实已经送达（丢的是回执而不是消息），重发会让代理收到两遍。

## 协调者一直等不到工作代理的答复

工作代理的最终回答在它的 Stop 钩子触发时被保存，但不会推送给派发它的人；协调者如果本身不是 Octogent 终端，也收不到 channel 消息。用 `octogent terminal wait <terminal-id> [...]` 阻塞到工作代理结束并打印回答，或随时用 `octogent terminal result <terminal-id>` 读取；脚本用 `--json`。两条命令都是只读的，对任何近期版本的运行中服务都有效。

## 终端能撑过页面刷新，却撑不过服务重启

这同样是预期行为。PTY 会话可以在重连窗口内存活，但不会在 API 重启后存活。

重启后，之前持久化为 running 的终端在 Octogent 无法接回内存中的 PTY 会话时会被标记为 `stale`。用 `octogent terminal list` 查看生命周期状态，用 `octogent terminal stop <terminal-id>` 或 `octogent terminal kill <terminal-id>` 处理记录中的进程，用 `octogent terminal prune` 从 UI 中移除 stale、stopped 或 exited 的记录。

> 本文件是 [../../reference/troubleshooting.md](../../reference/troubleshooting.md) 的中文翻译版本。如有歧义，以英文原文为准。

## 工人正在等待对话框

用 `octogent terminal list` 查找 `waiting=permission:Read 7m` 或 `waiting=user 3m`。`octogent terminal result <id>` 显示等待类型、已知工具和开始等待的时间。需要处理不会立即改变生命周期：到达停滞阈值前仍为 `running`（`OCTOGENT_TERMINAL_STALL_MS`，默认 120000 毫秒，每 30 秒检查一次）。对话框重绘不会刷新活动时间；停滞后原因类似 `waiting for permission: Read (since ...)`。

`octogent terminal wait <id>` 在等待输入达到 60 秒后的轮询中打印相关结果块并退出 `3`。用 `--attention-after <秒>` 调整时长，或设为 `0` 禁用。运行 `octogent terminal screen <id>` 检查权限请求或问题，用 `terminal input` 作出回答，再运行 `wait`。PTY 仍存活，需要处理时退出不会停止会话。运行时离开等待状态后会清除等待信息。不要为同一任务重复启动工人。


先查看卡住的工人，再根据实际对话框选择回答（下面的 `1` 仅为示例，不要盲目批准权限）：

```bash
octogent terminal screen <id> --lines 40
octogent terminal input <id> "1" --enter
octogent terminal input <id> --keys esc
octogent terminal result <id> --screen
```

`channel send` 等待空闲，无法回答忙碌回合中的对话框；`terminal input` 直接写入存活的 PTY。使用量耗尽、启动失败或退出后的诊断，可用 `result --screen` 或 `screen` 查看；已结束会话的屏幕会标注保存时间。屏幕是保留的滚动历史在终端模拟器中的回放，对话框按绘制结果显示，但超出滚动缓冲区的更早输出不包含在内。未启动的会话可能没有屏幕；重启不会恢复 PTY，只有正常清理时保存的屏幕可用。

## 工作代理撞上用量上限或 API 错误

代理 CLI 只在屏幕上报告服务商那边的失败：Codex 因用量上限结束一轮时不触发 Stop 钩子，Claude 打印 API 错误后就停在那里。Octogent 会在每个终端的 PTY 输出里识别这类横幅——用量上限、速率限制、API 错误（如连接中断、服务过载）以及登录失效——并把第一条匹配的行记录到终端的 `providerError`（`kind`、`message`、`at`）上。只有位于行首的横幅才算数，所以工作代理在自己的正文里讨论“上限”不会被误判；CLI 自己还在重试的提示也会被忽略。同一条横幅反复重绘不会重新计时。

错误存在期间，生命周期仍为 `running`，原因为 `provider error: <横幅内容>`；之后若进入停滞，原因也保持这一条，而不是 `no transcript activity`。`octogent terminal list` 在行尾追加 `error=usage-limit`（或 `rate-limit`、`api-error`、`auth`），`octogent terminal result <id>` 在“需要处理”行之后打印一行服务商错误。服务商错误持续 30 秒后，`octogent terminal wait` 就退出 `3`——比对话框的阈值更早，因为干等解除不了上限；`--attention-after 0` 同样会禁用这一项。代理重新取得真实进展时错误自动清除：下一次工具调用，或给出完成判定的 Stop 钩子；重新启动的会话也从无错误开始。单纯发一条新提示词不会清除它，因为代理可能再次撞上同一堵墙。

按类型处理：

- `usage-limit`：不要再派给同一个服务商。横幅通常写明重置时间；等到那时，或用别的 `--agent-provider` / `--model` 重新创建工作代理。
- `rate-limit` 或 `api-error`：多半是暂时的。稍等片刻后用 `octogent channel send <id> "continue"` 让它继续，再确认下一次工具调用清除了错误。
- `auth`：在主机上重新登录 CLI（在 `claude` 里执行 `/login`，或 `codex login`）；工作代理无法自行恢复。

识别依据是屏幕文字，所以如果某个工具结果的第一行本身就是这样的横幅（比如工作代理打印了一段错误日志），也会触发；下一次工具调用会清除它。另外，当服务端最近一次获取的用量已经显示所选服务商额度耗尽时，`octogent terminal create` 也会给出警告，见 [CLI 参考](cli.md) 的“创建终端”一节。
