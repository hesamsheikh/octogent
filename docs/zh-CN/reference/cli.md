# CLI 参考

## 启动工作面板

```bash
octogent
```

为当前项目启动本地 API，并在存在打包好的 Web 资源时打开 UI。

如果当前目录尚未初始化，工作面板依然会启动，但会运行在一个临时状态根目录之上，并显示一张引导卡片提示你运行 `octogent init`。本地 `.octogent/` 脚手架由 `octogent init`（或引导卡片上的**初始化工作区**操作）创建，工作面板本身不会创建。初始化之前创建的任何内容都会在初始化时迁移进项目。

### 环境变量

- `HOST`：绑定的主机地址（默认 `127.0.0.1`；当 `OCTOGENT_ALLOW_REMOTE_ACCESS=1` 时默认 `0.0.0.0`）
- `OCTOGENT_API_PORT` 或 `PORT`：监听端口（默认 `8787`）
- `OCTOGENT_ALLOW_REMOTE_ACCESS`：设为 `1` 允许其他机器访问；会放宽 host/origin 校验，并且在未显式设置 `HOST` 时绑定 `0.0.0.0` 而非 `127.0.0.1`
- `OCTOGENT_WORKSPACE_CWD`：覆盖工作区目录
- `OCTOGENT_HOME`：覆盖全局状态根目录（默认 `~/.octogent`）
- `OCTOGENT_PROJECT_STATE_DIR`：覆盖项目状态目录
- `OCTOGENT_PROMPTS_DIR`：覆盖提示词目录
- `OCTOGENT_WEB_DIST_DIR`：覆盖 Web UI 产物目录
- `OCTOGENT_LOCALE`：UI/CLI 语言（`en` 或 `zh-CN`）
- `OCTOGENT_MAX_TERMINAL_SESSIONS`：并发运行终端会话的上限
- `OCTOGENT_TERMINAL_STALL_MS`：运行中的终端在多少毫秒无转录活动后被标记为 `stalled`（默认 `120000`）
- `OCTOGENT_TERMINAL_IDLE_GRACE_MS`：释放保活后，没有浏览器连接的 PTY 再保持打开多少毫秒（默认 `300000`，即 5 分钟；非法值回落默认）。通过 `--initial-prompt` 创建的工作代理默认在轮次之间保活，只有工作已证实合并的工作树模式 `completed` 终端例外。`awaiting-review` 保留原有豁免。归档会释放保活；停止则立即关闭会话
- `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN`：在启动 Octogent 前设为 `1`，恢复每次 Stop hook 后释放工作代理保活的旧行为。未设置或其他值均默认让带初始提示词的工作代理在轮次之间保活。原有的 `awaiting-review` 和刚投递通道消息的豁免仍然有效
- `OCTOGENT_TERMINAL_RETENTION_HOURS`：`completed`、`stopped`、`exited` 终端记录在多少小时后被自动归档；`awaiting-review` 记录永不过期（默认 `72`，非法值回落默认）
- `OCTOGENT_CLAUDE_USAGE_SOURCE`：Claude 用量数据源：`auto`（OAuth 优先、CLI PTY 回退）、`oauth`、`cli`，或 `off` 禁用采集（默认 `auto`）
- `OCTOGENT_CODEX_SANDBOX_MODE`：Codex 沙箱模式：`read-only`、`workspace-write` 或 `danger-full-access`。未设置时，worktree 终端默认 `danger-full-access`，shared 终端默认 `workspace-write`——在 `workspace-write` 下 Codex 会把 `.git` 挂载为只读，worktree 代理将永远无法提交自己的工作；而 Claude 本就没有沙箱，因此这样对齐了两种提供方的行为
- `OCTOGENT_EFFORT_MODELS`：JSON 格式，按 provider 覆盖难度档位到模型的映射，例如 `{"light":{"claude-code":"haiku","codex":"gpt-5.6-luna@low"}}`；codex 条目用 `model@reasoning` 打包推理档位。默认映射（codex 侧跟随 2026-09-08 的模型列表）：`light` = haiku / gpt-5.6-luna@low、`standard` = sonnet / gpt-5.6-sol@medium、`heavy` = opus / gpt-6-astra@medium、`max` = fable / gpt-6-astra@xhigh。GPT-6 按账号逐步开放，所以 codex 各档带有回退（`standard` → gpt-5.6-terra@medium、`heavy` → gpt-5.6-sol@high、`max` → gpt-5.6-sol@xhigh）：本机 codex 的模型缓存（`$CODEX_HOME/models_cache.json`）里没有首选模型时自动启用；本变量里的 codex 条目同样可以写成按优先级排列的 JSON 数组。codex 的 `max`、`ultra` 推理档不做默认（`ultra` 会自派子代理），需要时通过本变量指定。Claude 侧用家族别名，会自动跟随新一代模型（当前 haiku→Haiku 4.5、sonnet→Sonnet 5、opus→Opus 5、fable→Fable 5.1）。注意：只用 `--model` 显式指定 codex 模型而不带 `--effort` 时，推理档位沿用 codex 自身默认（如 gpt-5.6-sol 默认为 `low`）；只有 `--effort` 档位会显式设定推理档
- `OCTOGENT_CODEX_APPROVAL_POLICY`：Codex 审批策略：`on-request` 或 `never`（默认 `never`，避免无人值守的终端卡在审批提示上）
- `OCTOGENT_CODEX_CONFIG`：覆盖 Octogent 用于预置项目信任与钩子信任哈希的 Codex `config.toml` 路径（主要用于测试隔离）
- `OCTOGENT_ACCESS_TOKEN`：开启远程访问时非回环客户端必须携带的访问令牌；未设置时每次启动自动生成并随局域网地址打印

无界面服务器示例：

```bash
OCTOGENT_ALLOW_REMOTE_ACCESS=1 octogent
# 或指定自定义主机
HOST=192.168.1.100 octogent
```

## 初始化项目

```bash
octogent init [project-name]
```

在当前目录创建或更新 `.octogent/` 脚手架，但不启动工作面板。

当你想显式初始化项目，或提前设置项目显示名时使用它。日常使用中，在代码库里直接运行 `octogent` 就足以完成初始化并启动应用。

## 列出已注册项目

```bash
octogent projects
```

## 创建触手

```bash
octogent tentacle create <name> --description "API runtime and routes"
```

此命令要求 Octogent 已经在运行。

## 列出触手

```bash
octogent tentacle list
```

## 创建终端

```bash
octogent terminal create [options]
```

选项：

- `--name`、`-n`：终端显示名
- `--workspace-mode`、`-w`：`shared` 或 `worktree`
- `--initial-prompt`、`-p`：初始提示词原文
- `--terminal-id`：显式指定终端 ID
- `--tentacle-id`：要挂载到的已有触手 ID。不传则终端直属 octoboss（触手 ID 等于它自己的终端 ID）；先建了触手并不会让之后的终端自动挂上去
- `--worktree-id`：显式指定工作树 ID
- `--parent-terminal-id`：子终端的父终端 ID
- `--agent-provider`：agent 提供方，`claude-code` 或 `codex`（未传时沿用服务端默认）
- `--model`：显式指定 agent 模型标识符（仅允许字母、数字与 `.` `_` `-`）；优先于 `--effort`
- `--effort`：难度档位 `light`、`standard`、`heavy` 或 `max`；由服务端按 provider 映射到具体模型（见 `OCTOGENT_EFFORT_MODELS`）
- `--prompt-template`：提示词模板名称
- `--prompt-variables`：提示词模板变量的 JSON 对象

## 列出终端

```bash
octogent terminal list
```

显示每个终端的 ID、生命周期状态、可用时的进程 ID、生命周期原因和显示名。已归档记录默认隐藏；传入 `--archived` 可仅列出已归档记录。

## 停止或杀死终端

```bash
octogent terminal stop <terminal-id>
octogent terminal kill <terminal-id>
```

`stop` 关闭活动会话，或对 stale 终端记录的进程发送 `SIGTERM`；`kill` 使用 `SIGKILL`。

## 归档终端记录

```bash
octogent terminal archive <terminal-id>
octogent terminal archive --all-completed
```

归档会在记录上写入 `archivedAt`，使默认列表隐藏它；转录与完成摘要仍保留在磁盘上。运行中的终端不能归档。`--all-completed` 归档所有生命周期状态为 `completed` 的记录。`completed`、`stopped`、`exited` 状态的记录在超过 `OCTOGENT_TERMINAL_RETENTION_HOURS` 后也会被自动归档；`awaiting-review` 记录永不自动归档，未合并的工作会一直醒目。

## 删除终端

```bash
octogent terminal delete <terminal-id>
octogent terminal delete <terminal-id> --with-worktree [--force]
```

`delete`（别名 `rm`）删除终端记录。默认**只删记录、保留 worktree 目录在磁盘**（遵循"未合并工作永不自动删"的原则）。加 `--with-worktree` 才会连同删除 worktree 目录与分支——删除前会检查该 worktree 是否仍被其他终端共享（是则拒绝），以及分支是否有未合并提交（有则拒绝并提示数量，需再加 `--force` 才会强删）。

## 清理不活跃的终端记录

```bash
octogent terminal prune
```

移除生命周期状态为 `stale`、`stopped` 或 `exited` 的终端记录。不会移除活动会话。prune 只清理记录、不触碰磁盘；要回收已合并的 worktree 与分支，请使用 `octogent worktree gc`。

## 回收已合并的 worktree

```bash
octogent worktree gc
octogent worktree gc --dry-run
```

删除所有「已归档且已确证合并」的 worktree 终端对应的 worktree 目录与分支。gc 时会现场问 git：worktree 的 HEAD 已是操作者分支的祖先（且没有未提交内容）即视为已合并，哪怕记录本身没记下这次合并；反之 git 说未合并的分支一律保留，哪怕记录标着已合并。只有 git 无法回答时才看记录信号——生命周期状态为 `completed`，或完成摘要标记了 `merged`。未合并的工作（包括 `awaiting-review`）永不回收；由多条终端记录共享的 worktree，只有在每条记录都满足条件时才会回收。`--dry-run` 仅列出可回收的 worktree，不做任何删除。归档扫描器在归档记录时也会自动回收符合条件的 worktree。无论哪种方式，终端记录本身都保持不变——清理记录是 `octogent terminal prune` 的职责。

## 等待工作代理并读取它的回答

```bash
octogent terminal wait <terminal-id> [<terminal-id>...] [--timeout <秒>] [--interval <秒>] [--json]
octogent terminal result <terminal-id> [--json]
```

`wait` 轮询直到列出的每个终端都已尘埃落定——`awaiting-review`、`completed`、`stopped`、`exited` 或 `stale`——过程中打印每次状态变化，最后打印每个终端的结果块。全部以 `awaiting-review` 或 `completed` 结束时退出码为 `0`，任一以其他方式结束为 `1`，超时为 `2`（`--timeout 0` 即默认值表示一直等；`--interval` 默认 5 秒、最小 1 秒）。`result` 不等待，立即打印同样的结果块。

结果块包含生命周期状态与原因、代理与模型、完成摘要（有提交时：提交数、文件数、分支、是否已合并），以及代理在 Stop 钩子里留下的最终回答。`--json` 按终端各输出一个 JSON 对象，方便脚本使用。无界面的协调者就靠它拿到工作代理的答复，不必自己挂终端的 WebSocket；把成果写进文件（例如触手目录下的 `RESULT.md`）的工作代理，通常会在最终回答里给出路径。

## 发送消息

```bash
octogent channel send <terminal-id> "message"
```

代表某个工作代理或父终端发送时，使用 `--from <terminal-id>`。省略 `--from` 时，若命令运行在 Octogent 托管的终端里，CLI 会回退使用 `OCTOGENT_SESSION_ID`。

## 列出消息

```bash
octogent channel list <terminal-id>
```

> 本文件是 [../../reference/cli.md](../../reference/cli.md) 的中文翻译版本。如有歧义，以英文原文为准。
