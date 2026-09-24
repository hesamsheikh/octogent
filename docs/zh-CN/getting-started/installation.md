# 安装

Octogent 是一个本地 Node.js 项目，包含本地 API 和 Web UI。

## 系统要求

- Node.js `22+`（用 [nvm](https://github.com/nvm-sh/nvm) 装的也可以；安装时所在的 shell 要先 `nvm use`）
- `pnpm` `10+`——仓库是 pnpm workspace。先装一次：`npm install -g pnpm`（或 `corepack enable`）。**不要**在仓库里跑 `npm install`：它解析不了 workspace 里的包，还会留下一个多余的 `package-lock.json`
- Linux 上编译 `node-pty` 原生模块需要 C++ 工具链：`python3`、`make`、`g++`（Debian/Ubuntu：`sudo apt install build-essential python3`）。macOS 自带预编译二进制。Windows 请装在 WSL 里，见[Windows：装在 WSL 里](#windows装在-wsl-里)
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

## Windows：装在 WSL 里

Octogent 的代理都跑在 POSIX shell 里（钩子回调、代理启动命令、工人环境都是按 bash 写的），所以在 Windows 上要装进 WSL 2，而不是原生安装。面板照样在 Windows 浏览器里打开：WSL 2 会把 `127.0.0.1` 转发到 Windows。

1. 如果 WSL 还没有发行版：以管理员身份打开 PowerShell，`wsl --install -d Ubuntu`，重启后按提示创建 Linux 用户。
2. 进入发行版（`wsl`），**在 Linux 里**安装全部依赖——WSL 的 `PATH` 里能看到的 Windows 版 `node`、`pnpm`、`claude`（位于 `/mnt/c/...` 或 `/mnt/d/...`）不能用，它们的原生模块和路径都是 Windows 的：

   ```bash
   sudo apt update && sudo apt install -y build-essential python3 git curl
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.nvm/nvm.sh && nvm install 22
   npm install -g pnpm@10 @anthropic-ai/claude-code      # 以及/或者：npm install -g @openai/codex
   which node pnpm claude                                 # 三个都必须在 ~/.nvm 下，而不是 /mnt/
   ```

3. 按[从克隆仓库进行本地全局 CLI 安装](#从克隆仓库进行本地全局-cli-安装)克隆并构建，放在 Linux 家目录（`~/octogent`），不要放在 `/mnt/c` 下——从 WSL 访问 Windows 文件系统很慢，文件监听也不可靠。
4. 在 **WSL 里**把代理 CLI 登录一次（`claude`、`codex login`）；Windows 上的登录是分开的，不会被用到。
5. 项目也放在 Linux 文件系统里（`~/code/...`），在那里运行 `octogent`，把它打印的 `http://127.0.0.1:8787/p/<slug>/` 在 Windows 浏览器里打开。

如果 WSL 的 `PATH` 先找到了 Windows 的工具，要么让 nvm 排在前面（登录 shell 下默认如此），要么在 `/etc/wsl.conf` 里关掉追加 Windows `PATH`：

```ini
[interop]
appendWindowsPath = false
```

然后在 PowerShell 里 `wsl --shutdown`。

让 hub 保持运行。最后一个 `wsl` 会话关闭后不久，Windows 会停掉该 WSL 发行版，hub（以及所有工人）也随之停止。给 hub 留一个会话——开一个终端标签页运行 `wsl -- bash -c '. ~/.nvm/nvm.sh && octogent hub start --foreground'`——或者用"任务计划程序"在开机时运行同一条命令。

## npm 注册表安装

Octogent 尚未发布到 npm 注册表，因此 `npm install -g octogent` 会失败并返回 `404`。

## 首次运行行为

在项目目录（git 仓库）中运行 `octogent` 将会：

- 如果没有 hub 在运行，在后台启动 hub，监听 `127.0.0.1:8787`（见[通过 hub 运行 Octogent](../guides/hub.md)）
- 如果 `.octogent/` 不存在则创建它，并把稳定的项目 ID 写入 `.octogent/project.json`
- 在 `~/.octogent/projects.json` 中注册该项目
- 把运行时状态保存在 `~/.octogent/projects/<project-id>/state/`
- 除非设置了 `OCTOGENT_NO_OPEN=1`，否则打开项目页面 `http://127.0.0.1:8787/p/<slug>/`
- 显示 Deck 设置卡片，直到创建第一个触手

`octogent init` 还会把 `.octogent` 添加到 `.gitignore`（不存在时创建 `.gitignore`），并写入一份起始的 `.octogent/env`。`octogent --standalone` 则改为启动单项目服务器，从 `8787` 起取第一个可用端口。

## 启动规则

- 如果 `claude` 或其他受支持的供应商二进制文件不可用，启动将失败
- 当缺少 `git`、`gh` 或 `curl` 等可选集成时，启动会发出警告

## 下一步

- [快速入门](quickstart.md)

> 本文件是 [../../getting-started/installation.md](../../getting-started/installation.md) 的中文翻译版本。如有歧义，以英文原文为准。
