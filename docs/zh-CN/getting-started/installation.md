# 安装

Octogent 是一个本地 Node.js 项目，包含本地 API 和 Web UI。

## 系统要求

- Node.js `22+`（用 [nvm](https://github.com/nvm-sh/nvm) 装的也可以；安装时所在的 shell 要先 `nvm use`）
- `pnpm` `10+`——仓库是 pnpm workspace。先装一次：`npm install -g pnpm`（或 `corepack enable`）。**不要**在仓库里跑 `npm install`：它解析不了 workspace 里的包，还会留下一个多余的 `package-lock.json`
- Linux 上编译 `node-pty` 原生模块需要 C++ 工具链：`python3`、`make`、`g++`（Debian/Ubuntu：`sudo apt install build-essential python3`）。macOS 和 Windows 自带预编译二进制
- 至少一个已安装并登录的代理 CLI：`claude`（`npm install -g @anthropic-ai/claude-code`，然后运行一次 `claude` 完成登录）和/或 `codex`
- `git`（用于工作树终端）
- `curl`（用于 Claude 钩子回调流程）
- `gh`（GitHub 拉取请求功能，可选）

Codex 与 Claude Code 终端都受支持，用 `octogent terminal create --agent-provider` 按终端选择。

## 本地开发安装

```bash
pnpm install
pnpm dev
```

## 从克隆仓库进行本地全局 CLI 安装

```bash
git clone http://192.168.8.240/tao.chang/octogent.git   # 或 GitHub 上的 fork
cd octogent
pnpm install
pnpm build
npm install -g .
octogent --help
```

每一步在做什么、失败时查什么：

- `pnpm install` 结束时**不能**出现 "Ignored build scripts: … node-pty" 的警告。出现了就说明原生 PTY 模块没有编译，Octogent 启动会因缺少 `pty.node` 崩溃。运行 `pnpm approve-builds`（勾选 `node-pty`）后再 `pnpm install`，或者直接编译：

  ```bash
  cd node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty && npx node-gyp rebuild && cd -
  ```

  用 `ls node_modules/.pnpm/node-pty@*/node_modules/node-pty/build/Release/pty.node` 确认文件存在。
- `pnpm build` 生成 `dist/api` 和 `dist/web`。全局命令直接从克隆目录运行，所以每次 `git pull` 之后也要重新执行这一步。
- `npm install -g .` 把 `octogent` 链接进当前 Node 的 `bin` 目录（nvm 下是 `~/.nvm/versions/node/<版本>/bin/octogent`），它是指向克隆目录的软链。之后不要移动或删除克隆目录；要换位置就在新路径下再执行一次 `npm install -g .`。
- `octogent --help` 能打印出命令列表就说明装好了。然后到项目目录里运行 `octogent`。

如果之前在仓库里跑过 `npm install`，先清理：

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules package-lock.json
```

## npm 注册表安装

Octogent 尚未发布到 npm 注册表，因此 `npm install -g octogent` 会失败并返回 `404`。

## 首次运行行为

在项目目录中运行 `octogent` 将会：

- 如果 `.octogent/` 不存在则创建它
- 将 `.octogent` 添加到 `.gitignore`，如果 `.gitignore` 不存在则创建它
- 将稳定的项目 ID 写入 `.octogent/project.json`
- 在 `~/.octogent/projects.json` 中注册该项目
- 将运行时状态移至 `~/.octogent/projects/<project-id>/state/`
- 从 `8787` 开始选择一个可用的本地 API 端口
- 除非设置了 `OCTOGENT_NO_OPEN=1`，否则打开浏览器
- 显示 Deck 设置卡片，直到创建第一个触手

## 启动规则

- 如果 `claude` 或其他受支持的供应商二进制文件不可用，启动将失败
- 当缺少 `git`、`gh` 或 `curl` 等可选集成时，启动会发出警告

## 下一步

- [快速入门](quickstart.md)

> 本文件是 [../../getting-started/installation.md](../../getting-started/installation.md) 的中文翻译版本。如有歧义，以英文原文为准。
