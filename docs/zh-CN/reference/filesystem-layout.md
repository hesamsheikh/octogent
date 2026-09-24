# 文件系统布局

Octogent 按所有权划分文件。面向代理的项目上下文留在工作区；运行时拥有的状态放在按项目划分的全局状态目录。

## 项目本地文件

`.octogent/` 创建在工作区中。

主要路径：

- `.octogent/project.json`
- `.octogent/env`（可选）
- `.octogent/tentacles/`
- `.octogent/worktrees/`

`project.json` 保存用于定位全局状态的稳定项目 ID。tentacles 目录用于存放代理可读的 markdown。worktrees 是生成出来的执行检出目录，不应当作上下文存储使用。

`env` 是本项目工作代理的环境：`KEY=VALUE` 行，叠加在本项目每个代理终端的基线环境之上，每次会话启动时重新读取。`octogent init` 会写入起步模板（找到 `.venv/` 或 `venv/` 时直接启用它），且从不覆盖已有文件。它和 `.octogent/` 下的其他内容一样被 git 忽略，只属于当前这份克隆。语法与优先级见 [CLI 参考——工作代理的环境](cli.md#工作代理的环境)。

触手示例：

```text
.octogent/
  tentacles/
    api-backend/
      CONTEXT.md
      todo.md
      routes.md
```

当操作者或规划代理为触手挂上 Claude Code 技能时，`CONTEXT.md` 末尾可能带有一个受管理的 `Suggested Skills` 块。

Deck 也会为触手写入 UI 元数据，但不会写进这些 markdown 文件。颜色、状态、外观、路径和标签存放在全局 Deck 状态中。

项目本地的 Claude Code 技能（如有）位于：

```text
.claude/
  skills/
    some-skill/
      SKILL.md
```

## 全局状态

按项目划分的运行时文件存放在：

```text
~/.octogent/projects/<project-id>/
  logs/
    server.log
    server.log.1
    server.log.2
    server.log.3
  state/
```

`state/` 下值得注意的文件：

- `tentacles.json`
- `deck.json`
- `transcripts/<sessionId>.jsonl`
- `monitor-config.json`
- `monitor-cache.json`
- `code-intel.jsonl`
- `runtime.json`

`tentacles.json` 虽然沿用了历史名称，实际是终端注册表。它保存终端记录、生命周期状态、UI 状态、父子关联、工作区模式、工作树 ID 和显示名。

`deck.json` 保存 Deck 的展示元数据，不属于面向代理的触手文件。

`transcripts/*.jsonl` 独立于 PTY 回滚缓冲保存对话转录事件。回滚缓冲在内存中且有上限；转录会持久化。

`logs/server.log` 记录服务启动信息、运行时摘要和未捕获错误。文件达到 5 MB 时轮转并保留三代；可用 `OCTOGENT_SERVER_LOG` 覆盖或禁用此位置。

`runtime.json` 在项目的单项目服务器运行期间记录它的地址和 pid。该进程存活且能响应时，项目里的 CLI 命令优先用它，而不是 hub。

## 注册表与 hub 文件

机器级文件与各项目目录并列：

```text
~/.octogent/
  projects.json
  hub.json
  hub.lock
  hub.env
  hub/
    logs/
      server.log
      daemon-stderr.log
  projects/<project-id>/
```

- `projects.json` 是项目注册表。每个条目有 `id`、`name`、`path`、`createdAt`、`lastOpenedAt`，以及两个供 hub 使用的字段：`slug`，项目在 hub 地址（`/p/<slug>/`）中的键，在整个注册表内唯一，旧文件加载时自动补齐；`aliases`，项目改名前用过的 slug，保留下来让旧链接继续可用，且永不分配给别的项目。该文件先写到临时文件名再改名替换，读取方不会读到写了一半的内容。
- `hub.json` 描述运行中的 hub：`{ apiBaseUrl, host, port, pid, startedAt, version, commit?, builtAt? }`。`commit` 取自 `OCTOGENT_BUILD_COMMIT`，`builtAt` 是 `dist/api/cli.js` 的修改时间；CLI 用它们与自身构建对比，以提示构建不一致。hub 开始监听后写入该文件，关闭时删除。除非其中的 pid 存活且 `GET /api/hub/health` 以同一 pid 响应，CLI 都视其为过期。
- `hub.lock` 只在某个 CLI 正在启动 hub 时存在，保证并发的 CLI 只启动一个 hub。它以独占方式创建，记录启动者的 pid，60 秒后或该 pid 退出后即视为过期。
- `hub.env` 可选，由你自己编写：每行一个 `KEY=value`，由 [systemd 服务](systemd.md)载入 hub 的环境（`OCTOGENT_HUB_PORT`、`OCTOGENT_ACCESS_TOKEN` 等）。以其他方式启动的 hub 不读取它。
- `hub/logs/server.log` 是 hub 的服务日志：所有项目共用一个文件，每行带 `[<slug>]` 标记，轮转方式与项目日志相同。`daemon-stderr.log` 保存后台 hub 最近一次启动时的 stderr（日志开始前或服务日志之外打印的内容，例如加载时崩溃）。

`octogent hub install-service` 还会在状态根目录之外写一个文件：`~/.config/systemd/user/octogent-hub.service`（设置了 `$XDG_CONFIG_HOME` 时位于其下），即 hub 的 systemd 用户 unit。它用一行 `OCTOGENT_HOME=` 写明所服务的状态根目录；只有这一行指向 CLI 自己的状态根目录时，CLI 才会经由 systemd 启动 hub。

## 提示词存储

- 核心提示词从 `prompts/` 同步
- 同步副本位于 `.octogent/prompts/core/`
- 用户提示词位于 `.octogent/prompts/`

## 实用法则

面向代理的上下文，放在触手目录里。

运行时拥有的状态，去全局项目状态目录找。

隔离的执行检出目录在 `.octogent/worktrees/` 下，其分支生命周期应视为创建它的那个终端的一部分。

> 本文件是 [../../reference/filesystem-layout.md](../../reference/filesystem-layout.md) 的中文翻译版本。如有歧义，以英文原文为准。

`transcripts/<terminalId>.screen.txt` 在会话结束时尽力保存最后 200 行处理后的 PTY 文本，供 `terminal screen` 回退读取。
