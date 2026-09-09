<div align="center">

<img width="1500" height="500" alt="Octogent header" src="./static/images/octogent-header.png" />
<br/>
<br/>

<strong>终端太多，触手不够用</strong>
<br />
<br />

![Last Update](https://img.shields.io/github/last-commit/hesamsheikh/octogent?label=Last%20Update&style=flat-square)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-5FA04E?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Follow on X](https://img.shields.io/badge/Follow%20on-X-000000?style=flat-square&logo=x)](https://x.com/Hesamation)
[![Discord](https://img.shields.io/badge/Discord-Open%20Source%20AI%20Builders-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/vtJykN3t)

</div>

# Octogent

同时开着**十个 Claude Code 会话**，不停地来回切换，还要记住每个会话在做什么——这真的很糟糕。当一个 agent 在写文档，另一个在改数据库，另一个在动 API，还有一个在前端里折腾的时候，*事情很快就会变得一团糟*。**Octogent** 试图解决这个问题：它为每个任务提供<u>独立的作用域上下文、笔记和任务列表</u>，同时让 Claude Code 能够**派生其他 Claude Code agent**、给它们分配工作并与它们通信。

## 愿景

这个仓库是一次个人探索——当终端编码 agent 被视为更大编排层的一部分，而非最终界面本身时，AI 编码环境会是什么样子。重点不是把 **Claude Code** 藏在抽象层后面，而是让*多 agent 协作在真实代码库中对开发者来说不那么混乱*。

## 截图

<div align="center">
<table>
<tr>
<td><img src="./static/images/preview_1.jpg" alt="截图 1" width="100%"/></td>
<td><img src="./static/images/preview_2.jpg" alt="截图 2" width="100%"/></td>
</tr>
<tr>
<td><img src="./static/images/preview_3.jpg" alt="截图 3" width="100%"/></td>
<td><img src="./static/images/preview_4.jpg" alt="截图 4" width="100%"/></td>
</tr>
<tr>
<td><img src="./static/images/preview_5.jpg" alt="截图 5" width="100%"/></td>
<td><img src="./static/images/preview_6.jpg" alt="截图 6" width="100%"/></td>
</tr>
</table>
</div>

## Octogent 能为你做什么

- **将触手（tentacle）作为上下文层创建**，让 agent 使用作用域内的 markdown 文件工作，而不是面对宽泛杂乱的聊天上下文
- **使用 `todo.md` 作为执行界面**，让任务保持可见、可追踪、随时可委派
- **运行多个 Claude Code 终端**，让一个开发者能同时协调多个编码会话
- **从 todo 条目派生子 agent**，让并行工作有一个具体的可信来源
- **支持 agent 间消息传递**，让工作 agent 和协调 agent 能够报告完成情况、阻塞问题和交接记录
- **将 agent 面向的上下文保留在文件中**，让系统比单个提示词线程更持久
- **提供本地 API 和 UI**，用于终端生命周期管理、持久化、WebSocket 传输和编排

**触手（tentacle）** 是 `.octogent/tentacles/<tentacle-id>/` 下的一个文件夹，包含 agent 可读的 markdown 文件，如 `CONTEXT.md`、`todo.md`，以及该代码区域所需的任何额外笔记。

章鱼的比喻很直观：*一只章鱼，多条触手，不同的工作同时进行*。

## 触手

**触手**是一个有作用域的任务容器。它为一块工作提供自己的文件、笔记和 `todo.md`，这样 agent 就不必从聊天历史中重新构建整个代码库的上下文。

它的作用：

- 将上下文局限在一个区域，如文档、数据库工作、API 变更或前端工作
- 为 agent 提供可以读取和更新的持久化文件
- 通过 todo 条目提供自然的委派来源

完整模型请参见 [Tentacles](docs/zh-CN/concepts/tentacles.md) 和 [Working With Todos](docs/guides/working-with-todos.md)。

## 上下文、笔记和任务列表

在 Octogent 中，触手不仅仅是任务桶。它还是任务保存本地上下文的地方，包括关于代码库某部分的笔记、实现细节、交接文件，以及跟踪待办事项的 `todo.md`。Claude Code agent 可以在工作推进过程中读取和更新这些文件。

这意味着你可以：

- 将文档、数据库、API 或前端工作分离到不同的任务上下文中
- 存储帮助 agent 理解代码库某部分的笔记
- 为某个具体条目派生一个 agent
- 将更大的任务拆分为多个条目
- 启动一个 swarm，让多个 agent 并行处理列表中的任务
- 将触手内的文件作为"什么已完成、什么还没做"的共享可信来源

完整模型请参见 [Tentacles](docs/zh-CN/concepts/tentacles.md) 和 [Working With Todos](docs/guides/working-with-todos.md)。

## Claude Code 管理 Claude Code

这里的核心理念之一是，**Claude Code** 不应只被当作一个等待人类提示的终端会话。在 Octogent 中，一个 Claude Code agent 可以协调其他 Claude Code agent，为它们分配具体任务，并与它们交换简短消息，而人类则停留在编排层面。

这与 Claude Code 的子 agent 派生不同，因为你可以直接看到和控制每个工作 agent 在做什么。

这意味着 Octogent 不仅仅是多终端的仪表盘。它也是一种围绕有作用域的任务和共享上下文文件来构建父子 agent 行为的方式。

当前模型请参见 [Orchestrating Child Agents](docs/guides/orchestrating-child-agents.md) 和 [Inter-Agent Messaging](docs/guides/inter-agent-messaging.md)。

## 工作原理

Octogent 将通常混在一堆终端中的三个关注点分离开来：

1. **上下文** 存放在 `.octogent/tentacles/<tentacle-id>/` 中。`CONTEXT.md` 说明领域范围，`todo.md` 提供可执行的工作条目，额外的 markdown 文件保存笔记或交接信息。
2. **执行** 存在于由本地 API 管理的终端记录和 PTY 会话中。一个终端可以挂载到已有的触手上，多个终端可以在 swarm 工作期间共享一个触手。
3. **隔离** 是可选的。共享终端在主工作空间中运行；worktree 终端在 `.octogent/worktrees/<worktree-id>/` 下、`octogent/<worktree-id>` 分支上运行。

Deck 直接读取触手文件，解析 `todo.md` 中的复选框条目，并用未完成的条目生成工作 agent 的提示词。Claude hooks 向 API 提供 agent 状态、转录和空闲事件，让 UI 能展示比原始终端输出更丰富的内容。

## 快速开始

<details>
<summary><strong>本地开发</strong></summary>

```bash
pnpm install
pnpm dev
```

这将启动 API 和 Web 应用用于本地开发。

</details>

<details open>
<summary><strong>当前安装状态</strong></summary>

```bash
Octogent 尚未发布到 npm 仓库。
```

本地开发：

```bash
pnpm install
pnpm dev
```

从克隆仓库进行本地全局 CLI 安装（需要 pnpm 10+：`npm install -g pnpm`；Linux 还需要 `build-essential` 与 `python3` 来编译 node-pty）：

```bash
pnpm install     # 结束时不能有 "Ignored build scripts: … node-pty" 警告，否则先 pnpm approve-builds
pnpm build       # 每次 git pull 之后重跑
npm install -g . # 软链到克隆目录，之后别移动该目录
octogent --help
```

不要在仓库里用 `npm install`。完整说明与排错见 [安装文档](docs/zh-CN/getting-started/installation.md)。仓库安装流程 `npm install -g octogent` 需要等到包发布后才能使用。

</details>

首次运行时，**Octogent** 会自动创建本地 `.octogent/` 脚手架、分配稳定的项目 ID、从 `8787` 开始选择可用的本地 API 端口，并打开 UI（除非设置了 `OCTOGENT_NO_OPEN=1`）。

## 环境要求

- Node.js `22+`
- 已安装 `claude` 用于支持的 agent 工作流
- 已安装 `git` 用于 worktree 终端
- 已安装 `gh` 用于 GitHub Pull Request 功能
- 已安装 `curl` 用于当前的 Claude hook 回调流程

如果 `claude` 或其他受支持的 provider 二进制文件都未安装，启动会失败。当前文档仅涵盖 **Claude Code**。

## 持久化内容

- `.octogent/` 保存项目本地的脚手架和 worktree
- `~/.octogent/projects/<project-id>/state/` 保存运行时状态、转录、监控缓存和元数据
- `.octogent/tentacles/<tentacle-id>/` 保存 agent 读取的上下文文件和 todo

PTY 会话在空闲宽限期内可以在浏览器刷新后存活，但**不能**在 API 重启后存活。Octogent 在启动时会将之前运行但无法重新挂载到活动 PTY 会话的终端记录标记为 `stale`；使用 `octogent terminal list`、`stop`、`kill` 和 `prune` 来检查和清理它们。Octogent 默认将活动 PTY 会话上限设为 32 以保护宿主机；设置 `OCTOGENT_MAX_TERMINAL_SESSIONS` 为正整数可以为更大的编排运行调整此限制。

## 文档

- [用 Octogent 完成第一份工作](docs/zh-CN/guides/getting-work-done.md)
- [文档首页](docs/zh-CN/index.md)
- [安装](docs/zh-CN/getting-started/installation.md)
- [快速入门](docs/zh-CN/getting-started/quickstart.md)
- [心智模型](docs/zh-CN/concepts/mental-model.md)
- [触手](docs/zh-CN/concepts/tentacles.md)
- [运行时与 API](docs/concepts/runtime-and-api.md)
- [使用 Todo](docs/guides/working-with-todos.md)
- [编排子 Agent](docs/guides/orchestrating-child-agents.md)
- [Agent 间消息传递](docs/guides/inter-agent-messaging.md)
- [CLI 参考](docs/reference/cli.md)
- [文件系统布局](docs/reference/filesystem-layout.md)
- [API 参考](docs/reference/api.md)
- [实验性功能](docs/reference/experimental-features.md)
- [故障排除](docs/reference/troubleshooting.md)
- [贡献指南](CONTRIBUTING.zh-CN.md)

## 贡献者配置

Octogent 目前不活跃审查 Pull Request。如果你仍然提交 PR，并且任何代码是用 AI 编写的，请披露使用了哪个编码 agent 和模型。有关贡献者工作流程和期望，请参见 [CONTRIBUTING.md](CONTRIBUTING.zh-CN.md)。

---

> 本文件是 [README.md](README.md) 的中文翻译版本。如有歧义，以英文原文为准。
