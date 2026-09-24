# CLI 参考

## 启动工作面板

```bash
octogent                        # 当前项目，在 hub 上
octogent --project <slug|id>    # 另一个已注册项目，可在任意目录运行
octogent --standalone           # 改为启动单项目服务器
```

直接运行 `octogent`（或 `octogent start`）会在 [hub](#运行-hub) 上打开当前项目。没有 hub 响应时，它会像 `octogent hub start` 那样启动一个；hub 还不认识该项目时，它会注册项目：git 仓库，或含有 `.octogent/project.json` 的目录，与[其他所有命令](#命令连到哪个服务器)遵循同一条规则。随后它打印 `<hub>/p/<slug>/` 并在浏览器中打开，除非设置了 `OCTOGENT_NO_OPEN=1`（或 `CI=1`）或缺少 Web 构建产物。不在任何项目中时，它打开 `<hub>/`，即所有项目的总览。页面打开后命令即返回，hub 留在后台运行，直到 `octogent hub stop`。设置 `OCTOGENT_NO_AUTOSTART=1` 时，它会报错并给出提示，而不是启动 hub。完整流程见 [hub 指南](../guides/hub.md)。

它绝不会在别的端口上启动 hub。如果占着 hub 端口的不是 hub（通常是 hub 出现之前的单项目服务器），它会像 `hub start` 一样失败，给出该进程的 pid 以及已知的项目，并提示可以用 `--standalone`。如果当前项目自己的单项目服务器仍在运行，它会打印并打开那个服务器的地址：让 hub 再加载一次该项目，会让两个运行时共用同一组状态文件。停掉那个服务器后再运行一次 `octogent`，项目就迁到 hub 上了。

`octogent --standalone` 为当前目录启动单项目服务器，它留在前台直到按 Ctrl-C，从 `8787` 起取第一个空闲端口（`OCTOGENT_API_PORT` 或 `PORT`）。如果当前目录尚未初始化，这个服务器会运行在临时状态根目录之上，并显示一张引导卡片提示你运行 `octogent init`。本地 `.octogent/` 脚手架由 `octogent init`（或引导卡片上的**初始化工作区**操作）创建，服务器本身不会创建。初始化之前创建的任何内容都会在初始化时迁移进项目。

### 环境变量

- `HOST`：绑定的主机地址（默认 `127.0.0.1`；当 `OCTOGENT_ALLOW_REMOTE_ACCESS=1` 时默认 `0.0.0.0`）
- `OCTOGENT_API_PORT` 或 `PORT`：单项目服务器从哪个端口开始找空闲端口（默认 `8787`）；hub 改用 `OCTOGENT_HUB_PORT`
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
- `OCTOGENT_EFFORT_MODELS`：JSON 格式，按 provider 覆盖难度档位到模型的映射，例如 `{"light":{"claude-code":"haiku","codex":"gpt-6-luna@medium"}}`；codex 条目用 `model@reasoning` 打包推理档位，也可以写成按优先级排列的 JSON 数组。默认映射（codex 侧跟随 2026-09-23 的模型列表，GPT-6 Sol 与 Luna 加入 Astra 之后）：`light` = haiku / gpt-6-luna@medium、`standard` = sonnet / gpt-6-sol@high、`heavy` = opus / gpt-6-astra@high、`max` = fable / gpt-6-astra@xhigh。GPT-6 按账号逐步开放，所以 codex 各档带有回退（`light` → gpt-5.6-luna@medium；`standard` → gpt-5.6-sol@medium、gpt-5.6-terra@medium；`heavy` → gpt-6-sol@xhigh、gpt-5.6-sol@high；`max` → gpt-6-sol@xhigh、gpt-5.6-sol@xhigh）：本机 codex 的模型缓存（`$CODEX_HOME/models_cache.json`）里没有首选模型时自动启用；`octogent guide` 会打印当前安装版本实际采用的映射。小模型不低于其默认推理档，因为 `low` 档会开始出事实性错误。codex 的 `max`、`ultra` 推理档不做默认（`ultra` 会自派子代理），需要时通过本变量指定。Claude 侧用家族别名，会自动跟随新一代模型（当前 haiku→Haiku 4.5、sonnet→Sonnet 5、opus→Opus 5.5、fable→Fable 5.1；Anthropic 自己的建议是日常功能/调试/评审用 Opus 5.5、规划与结果优先的工作用 Fable，`heavy` 与 `max` 就是这样分的）。注意：只用 `--model` 显式指定 codex 模型而不带 `--effort` 时，推理档位沿用 codex 自身默认（如 gpt-5.6-sol 默认为 `low`，GPT-6 系列为 `medium`）；只有 `--effort` 档位会显式设定推理档
- `OCTOGENT_CODEX_RATE_LIMIT_PROMPT`：Codex 弹出"Approaching rate limits — Switch to <更省的模型>?"提示时 Octogent 的做法。这个提示没有任何钩子上报，不处理的话会吞掉下一条粘贴进去的消息：`keep`（默认——回答"Keep current model"，工人留在你选的模型上；真撞到限额时会作为供应商错误报出来）、`switch`（接受更省的模型）、`ask`（留在屏幕上并把工人标为等待用户，`terminal wait` 以 3 退出）
- `OCTOGENT_CODEX_APPROVAL_POLICY`：Codex 审批策略：`on-request` 或 `never`（默认 `never`，避免无人值守的终端卡在审批提示上）
- `OCTOGENT_CODEX_CONFIG`：覆盖 Octogent 用于预置项目信任与钩子信任哈希的 Codex `config.toml` 路径（主要用于测试隔离）
- `OCTOGENT_ACCESS_TOKEN`：开启远程访问时非回环客户端必须携带的访问令牌。未设置时，单项目服务器每次启动自动生成并随局域网地址打印；hub 则必须设置至少 32 个字符的令牌
- `OCTOGENT_VERBOSE_LOGS`：设为 `1`，同时把详细的钩子和运行时摘要打印到终端。无论是否设置，详细摘要都会写入服务日志
- `OCTOGENT_SERVER_LOG`：设为 `off` 可禁用服务日志；设为文件路径可覆盖默认的 `<project-state-dir>/logs/server.log`（hub 为 `~/.octogent/hub/logs/server.log`）
- `OCTOGENT_PTY_ENV_MODE`：设为 `inherit` 时，代理终端重新拿到服务进程的完整环境（仍去掉 Claude 会话标记），而不是[工作代理的环境](#工作代理的环境)一节所述的基线。这是应急开关，用于基线漏掉的场景；`.octogent/env` 与 `--inherit-env` 仍会叠加在上面

无界面服务器示例。hub 只在启动时读取这些变量，要修改就重启正在运行的 hub：

```bash
OCTOGENT_ALLOW_REMOTE_ACCESS=1 OCTOGENT_ACCESS_TOKEN="$(openssl rand -hex 32)" octogent hub start
# 或绑定指定地址
HOST=192.168.1.100 OCTOGENT_ACCESS_TOKEN="$(openssl rand -hex 32)" octogent hub start
# 或使用单项目服务器，它会为本次运行生成令牌
OCTOGENT_ALLOW_REMOTE_ACCESS=1 octogent --standalone
```

## 运行 hub

```bash
octogent hub start [--foreground]
octogent hub status
octogent hub stop
octogent hub restart [--force]
octogent hub install-service [--remove]
```

hub 是一个服务器服务所有已注册项目（见 [Hub 模式](api.md#hub-模式)）。`start` 在固定端口 `OCTOGENT_HUB_PORT`（默认 `8787`）上运行它，绝不换到别的端口：每个 CLI 都得不经询问就找到这唯一的 hub。如果端口被一个不是 hub 的进程占用（通常是单项目服务器：`octogent --standalone`，或 hub 出现之前启动的服务器），`start` 会失败并给出该进程的 pid，若该服务器的 `runtime.json` 有记录，还会给出它的项目。不带 `--foreground` 时 hub 在后台独立运行：`start` 最多等 15 秒，等它写好 `~/.octogent/hub.json` 并能响应 `GET /api/hub/health`，然后打印它的地址。`--foreground` 让它留在当前终端，直到按 Ctrl-C。两种方式都写日志到 `~/.octogent/hub/logs/server.log`；后台 hub 自己的 stderr（例如日志开始前就崩溃）写到 `~/.octogent/hub/logs/daemon-stderr.log`。

`status` 打印 hub 的地址及是否响应、pid 与启动时间、它的构建与本 CLI 构建的对照、日志路径，以及每个已注册项目（`*` 标出当前项目）是否已加载、有几个终端在运行或待审阅。没有 hub 响应时退出码为 `1`。`stop` 发送 `SIGTERM` 并等待 hub 退出，10 秒后仍未退出则发送 `SIGKILL`。由于崩溃后 pid 会被复用，只有当 `hub.json` 里的 pid 仍以 hub 身份响应（或在 Linux 上其命令行表明它就是 hub）时才会向它发信号。`restart` 即先 `stop` 再 `start`，但只要有项目存在 `running` 或 `awaiting-review` 的终端就拒绝执行——这些会话会随 hub 一起终止——并列出它们；加 `--force` 则照样重启。

项目在第一次被请求点名时加载。在 `OCTOGENT_HUB_PROJECT_IDLE_MS` 时长内既没有 PTY 会话、没有打开的仪表盘页面、也没有进行中的请求时，它会被卸载：上下文停止，日志记下这一事件，`hub status` 与 `GET /api/projects` 显示它未加载。它的状态留在磁盘上，下一次请求会重新加载它。待审阅的终端只有在 PTY 仍打开时才会让项目保持加载。

`install-service` 在 Linux 上把 hub 装成 systemd 用户服务，见[以 systemd 用户服务运行 hub](systemd.md)。装好该 unit 后，每次启动 hub（`hub start`、`hub restart`、自动启动、直接运行 `octogent`）都会执行 `systemctl --user start octogent-hub`，因此唯一的 hub 由 systemd 监管。如果 systemctl 拒绝执行，CLI 会给出警告，照旧启动后台 hub。`--remove` 禁用服务并删除 unit，不影响正在运行的 hub。

hub 绑定 `127.0.0.1`。设置 `OCTOGENT_ALLOW_REMOTE_ACCESS=1`（或显式的 `HOST`）时，只有 `OCTOGENT_ACCESS_TOKEN` 持有至少 32 个字符的令牌，它才会绑定到回环以外的地址。与单项目服务器不同，hub 从不自动生成令牌，因为后台 hub 的令牌每次重启都会变。

- `OCTOGENT_HUB_PORT`：hub 的端口（默认 `8787`）
- `OCTOGENT_NO_AUTOSTART`：设为 `1` 时命令不会自动启动 hub，而是给出提示并失败（见下面第 4 步）
- `OCTOGENT_HUB_PROJECT_IDLE_MS`：已加载的项目在没有会话和请求的情况下多久后卸载（默认 `1800000`，即 30 分钟；`0` 表示始终保持加载）
- `OCTOGENT_HUB_MAX_TERMINAL_SESSIONS`：所有项目合计的 PTY 会话上限（默认 `32`）；每个项目另有自己的上限 `OCTOGENT_MAX_TERMINAL_SESSIONS`（hub 下默认 `12`）

### 命令连到哪个服务器

每个需要服务器的命令（`tentacle`、`terminal`、`worktree`、`channel`）按以下顺序选择：

1. **显式地址**：`OCTOGENT_API_BASE`，其次 `OCTOGENT_API_ORIGIN`，原样使用。Octogent 会在每个工作代理里设置 `OCTOGENT_API_BASE`，且已限定到该代理的项目，所以工作代理里的 CLI 总是连到自己的项目。
2. **项目自己的服务器**：当前项目的单项目服务器，前提是它的 `runtime.json` 记录的进程仍存活并能响应。`octogent --standalone` 启动的服务器照常可用。
3. **hub**：当 `~/.octogent/hub.json` 记录的 hub 存活时，命令发往 `<hub>/api/p/<id>`，项目取自 `--project <slug|id>`，没有该参数时取当前目录所属的项目（最近的 `.octogent/project.json`，否则是路径包含当前目录的已注册项目）。尚未注册的 git 仓库会当场注册（同时创建它的 `.octogent/`），CLI 打印一行注明其 slug；其他目录则给出提示并失败。
4. **没有 hub**：命令会像 `octogent hub start` 那样启动一个，然后继续第 3 步。`~/.octogent/hub.lock` 保证并发的多个命令只启动一个 hub，其余的等它就绪。`OCTOGENT_NO_AUTOSTART=1` 会把这一步变成报错。

所有这类命令都接受 `--project <slug|id>`，可放在命令行任意位置，也接受项目改名前的旧 slug。当 hub 运行的构建与 CLI 不同时——版本不同、`OCTOGENT_BUILD_COMMIT` 不同，或在没有 commit 信息时 `dist/api/cli.js` 在 hub 启动后被重新构建过——连到 hub 的命令每次会向 stderr 打印一行警告：等工作代理空闲时重启 hub（`octogent hub restart`）。

## 让代理学会 Octogent

```bash
octogent setup-agents            # 为 Claude Code 与 Codex 安装 Octogent skill（用户层）
octogent setup-agents --remove
octogent guide                   # 打印协调者工作法与当前命令一览
```

`setup-agents` 把一个 skill 目录复制到 `~/.claude/skills/octogent/` 与 `~/.codex/skills/octogent/`（尊重 `CLAUDE_CONFIG_DIR` / `CODEX_HOME`），不动那里的其他任何文件。此后这台机器上的每个 Claude Code / Codex 会话都会按需加载这套工作法——派发、`terminal wait`、`terminal result`、追问、审阅、收尾——不用再把文档贴进提示词。skill 把确切参数交给 `octogent guide`，所以已安装版本打印的总是当前真相；升级 Octogent 后再跑一次 `setup-agents` 刷新副本。

## 初始化项目

```bash
octogent init [project-name]
```

在当前目录创建或更新 `.octogent/` 脚手架，但不启动工作面板。

当你想显式初始化项目，或提前设置项目显示名时使用它。日常使用中，在 git 仓库里直接运行 `octogent` 就够了：hub 会注册它并创建 `.octogent/`。`init` 还会把 `.octogent` 加进 `.gitignore` 并写入 `.octogent/env`，注册时不会动这两处。

项目还没有 `.octogent/env` 时，`init` 会写入一份起步模板（见[工作代理的环境](#工作代理的环境)）。如果找到 `.venv/bin/activate` 或 `venv/bin/activate`，模板里的 virtualenv 行直接生效，工作代理会使用该环境；否则这些行保持注释，作为示例。已有的 `.octogent/env` 永远不会被覆盖，所以重复运行 `init` 是安全的。

## 列出已注册项目

```bash
octogent projects
```

每个已注册项目列出其 slug（它在 hub 地址 `/p/<slug>/` 中的键）、名称、id 和路径。`*` 标出当前目录所属的项目。

## 查看服务日志

```bash
octogent logs [--lines N] [--follow]
```

打印当前项目自己的服务日志（即 `--standalone` 服务器写的那份）的最后 100 行。在 hub 下，所有项目都写入 `~/.octogent/hub/logs/server.log`，每行带 `[<slug>]` 标记。用 `--lines N` 指定其他正整数行数；用 `--follow` 持续输出新日志，日志轮转后也会继续跟随。

## 创建触手

```bash
octogent tentacle create <name> --description "API runtime and routes"
```

与所有需要服务器的命令一样，它按[命令连到哪个服务器](#命令连到哪个服务器)一节的规则找到服务器。

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
- `--inherit-env NAME,...`：把当前 shell 中的这些变量传给该工作代理，例如 `--inherit-env PATH,VIRTUAL_ENV`。只有列出的变量会离开 CLI；变量名只能由大写字母、数字和 `_` 组成，最多 64 个；其中任何一个在当前 shell 中未设置时命令直接失败

创建成功后，如果服务端最近一次获取的用量显示所选服务商额度已耗尽，CLI 会向 stderr 打印一行警告：Codex 看 5 小时或每周窗口达到 100%，或账号级的上限标记；Claude 看 5 小时或每周窗口，或所请求模型对应的每周额度达到 100%。重置时间已过的读数会被忽略。只使用服务端为用量接口已经取到的读数——创建终端从不调用用量服务——没有读数时什么也不打印。

### 工作代理的环境

代理终端不会继承启动 Octogent 的那个 shell 的环境：一个服务进程可能同时服务多个项目，一个项目的 virtualenv 或密钥不能漏进另一个项目的工作代理。每个终端的环境按以下顺序构建，后面的步骤覆盖前面的：

1. **基线**，取自服务进程的环境：`HOME`、`USER`、`LOGNAME`、`SHELL`、`LANG`、`LC_*`、`TZ`、`PATH`、`TMPDIR`、`XDG_*`、`SSH_AUTH_SOCK`、`DISPLAY`、`WAYLAND_DISPLAY`、`DBUS_SESSION_BUS_ADDRESS`；代理 CLI 自己要读的：`ANTHROPIC_*`、`CLAUDE_CODE_*`、`CLAUDE_CONFIG_DIR`、`CODEX_*`、`OPENAI_*`、`OCTOGENT_*`、`NODE_*`、`NVM_*`；以及代理相关变量 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`、`ALL_PROXY`（大小写两种写法）和 `SSL_CERT_FILE`、`SSL_CERT_DIR`。其余一律丢弃——`VIRTUAL_ENV`、`DATABASE_URL`、云服务凭据都不会带过去。Claude 会话标记 `CLAUDECODE` 与 `CLAUDE_CODE_CHILD_SESSION` 始终被去掉：代理一旦以为自己是子会话，就不再保存 Octogent 依赖的转录。
2. **`<项目>/.octogent/env`**（存在时）：`KEY=VALUE` 行，支持 `#` 注释、空行、可选的 `export ` 前缀，两侧的单引号或双引号会被去掉。`$VAR` 与 `${VAR}` 基于基线和前面的行展开；`$PWD` 是项目根目录，工作树终端也一样。单引号内的 `$` 保持原样。每次会话启动都会重新读取该文件，修改后下一个会话即生效，无需重启。格式错误的行会被跳过，并在每次会话启动时于服务日志中报告一次，不会阻止终端启动。
3. **`--inherit-env` 变量**，来自创建该终端的 shell。
4. **Octogent 自己的变量**：`TERM`、`COLORTERM`、`OCTOGENT_SESSION_ID`、`OCTOGENT_API_BASE`。

Python 项目通常需要：

```bash
# .octogent/env
PATH=$PWD/.venv/bin:$PATH
VIRTUAL_ENV=$PWD/.venv
```

`.octogent/` 已被 git 忽略，所以这个文件只属于当前这份克隆。使用 `--inherit-env` 时，终端记录只保存变量名（`terminal result --json` 以 `inheritedEnv` 列出）；变量值只留在服务进程内存中，服务重启后再次启动的会话不会带上它们。需要持久生效的变量请写进 `.octogent/env`。`OCTOGENT_PTY_ENV_MODE=inherit` 可恢复为复制服务进程的完整环境。

## 列出终端

```bash
octogent terminal list
```

代理等待对话框时，行尾追加 `waiting=permission:Read 7m` 或 `waiting=user 3m`（已知的工具名和等待时长）。代理 CLI 打印了服务商错误横幅时，行尾追加 `error=usage-limit`、`error=rate-limit`、`error=api-error` 或 `error=auth`；见[故障排查](troubleshooting.md)。

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
octogent terminal wait <terminal-id> [<terminal-id>...] [--timeout <秒>] [--interval <秒>] [--attention-after <秒>] [--json]
octogent terminal result <terminal-id> [--json] [--screen]
```

`wait` 轮询直到列出的每个终端都已尘埃落定——`awaiting-review`、`completed`、`stopped`、`exited` 或 `stale`——过程中打印每次状态变化，最后打印每个终端的结果块。全部以 `awaiting-review` 或 `completed` 结束时退出码为 `0`，任一以其他方式结束为 `1`，超时为 `2`，工人需要处理时为 `3`（`--timeout 0` 即默认值表示一直等；`--interval` 默认 5 秒、最小 1 秒）。`result` 不等待，立即打印同样的结果块。

`--attention-after` 默认 60 秒，设为 `0` 禁用需要处理时的退出。每次轮询时，只要有尚未结束的工人等待权限或用户输入达到该时长，`wait` 就打印这些工人的结果块并退出 `3`，优先于超时检查。时长从对话框开始等待时算起，即使早于本次命令。尚未结束的工人若服务商错误（用量上限、速率限制、API 错误或登录失效）已持续 30 秒，同样视为需要处理，与 `--attention-after` 设的时长无关，除非它为 `0`。退出码 `1` 也用于参数或 API 错误。

结果块增加本地化的“需要处理”行，显示等待类型、已知的工具名和开始时间。JSON 提供 `attentionKind`、`attentionSince`（ISO 时间）和 `attentionToolName`（没有时为 null）。记录了服务商错误时，其后再加一行，显示错误类型、横幅内容和出现时间；JSON 中为 `providerError`（`{ kind, message, at }`，没有时为 null）。

结果块包含生命周期状态与原因、代理与模型、完成摘要（有提交时：提交数、文件数、分支、是否已合并），以及代理在 Stop 钩子里留下的最终回答。`--json` 按终端各输出一个 JSON 对象，方便脚本使用。无界面的协调者就靠它拿到工作代理的答复，不必自己挂终端的 WebSocket；把成果写进文件（例如触手目录下的 `RESULT.md`）的工作代理，通常会在最终回答里给出路径。

## 发送消息

```bash
octogent channel send <terminal-id> "message"
```

代表某个工作代理或父终端发送时，使用 `--from <terminal-id>`。省略 `--from` 时，若命令运行在 Octogent 托管的终端里，CLI 会回退使用 `OCTOGENT_SESSION_ID`。

命令会先说明消息是已投递（写进了空闲代理的终端）还是已排队（代理正忙），再提示用 `channel list` 查看代理是否已确认收到。投递本身不能证明代理收到，详见[代理间消息传递](../guides/inter-agent-messaging.md#已投递不等于已收到)。

## 列出消息

```bash
octogent channel list <terminal-id>
```

每条发往该终端、经当前运行的 API 进程发送的消息占一行：

```text
  [msg-3] from=terminal-1 status=delivered (awaiting receipt): Need review on the parser change
```

`status` 取值为 `pending`（排队中）、`delivered (awaiting receipt)`（已写入、尚无回执）、`confirmed`（代理的下一次提示词提交已到达）或 `failed: <原因>`（两次投递都未确认时为 `failed: not acknowledged`）。

> 本文件是 [../../reference/cli.md](../../reference/cli.md) 的中文翻译版本。如有歧义，以英文原文为准。

## 查看屏幕并直接输入

```bash
octogent terminal screen <id> [--lines N] [--raw]
octogent terminal input <id> [<text>] [--enter] [--keys <name,...>]
octogent terminal result <id> --screen [--json]
```

`screen` 默认打印最后 40 行（`--lines` 为 1–200）：按会话当前尺寸，把保留的滚动历史回放进无头终端模拟器（xterm.js）后取文本，因此用光标定位绘制的 TUI 对话框会按屏幕上的样子显示。回放受滚动缓冲区大小限制（约为最后 512 KiB 输出）：更早的输出已丢弃，依赖这些输出的重绘可能不完整。`--raw` 返回未经处理的实时尾部。会话结束时，最后 200 行渲染后的屏幕尽力保存到 `<stateDir>/state/transcripts/<terminalId>.screen.txt`；会先写入剥离后的文本（移除 ANSI/OSC、应用回车覆盖），渲染失败或服务在渲染完成前退出时保留该文本；没有实时会话时读取该文件并标注“保存于 <时间>”。保存内容不含原始转义序列，即使带 `--raw` 也如此。没有实时或已保存屏幕时退出码为 1；未启动的会话或服务被强制终止时可能没有屏幕。

`input` 不受代理忙碌或等待权限的状态限制，文本按字符输入，不使用括号粘贴。先发送文本，再按顺序发送 `--keys`，最后 `--enter` 延迟 150 毫秒发送回车。允许的按键为 `enter`、`esc`、`up`、`down`、`tab`、`ctrl-c` 和 `1`–`9`；其他名称被拒绝。纯按键输入可省略文本；以 `--` 开头的文本放在 `--` 分隔符之后。JSON 请求体及解码后的输入都最多 4096 字节（JSON 包装占用请求体额度）。需要存活的 PTY，不会启动会话；每次接受的请求记录 `input_submit` 审计事件。延迟回车前结束会话会取消该回车。

`result --screen` 附加最后 20 行；配合 `--json` 时增加 `screen: { text, savedAt, raw }`（没有屏幕时为 `null`）。实时屏幕的 `savedAt` 为 `null`，保存屏幕的时间为 ISO 格式。
