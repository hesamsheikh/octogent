# 用 Octogent 完成第一份工作

## 第一部分：十分钟上手

开始前：已安装 Octogent、登录 `claude` 或 `codex`，并准备一个有提交的 Git 仓库。

### 1. 启动 Octogent

在项目目录运行下面两行，启动后保持这个窗口运行。
网页里的 octoboss（大章鱼）是项目的总协调入口。

```bash
octogent init
octogent
```

可选：`init` 会把 `.octogent` 写进 `.gitignore`，可以顺手把这条改动提交到 Git。

### 2. 建一个触手

另开一个命令行窗口，进入同一项目目录。
创建一个触手（tentacle，也叫小章鱼），保存这条工作的背景、待办和交接文件。

```bash
octogent tentacle create first-task --description "第一次派发、审阅和合并"
```

### 3. 派第一个任务给 Claude Code 或 Codex

终端（terminal）运行一个代理会话；工作树（worktree）是供它单独改文件和提交的 Git 副本。
下面用 Claude Code；用 Codex 时把 `claude-code` 换成 `codex`。
`--tentacle-id first-task` 指定归属，漏掉就直属大章鱼。

```bash
octogent terminal create --terminal-id first-worker --name "说明文档小修" \
  --tentacle-id first-task --workspace-mode worktree \
  --agent-provider claude-code --effort standard \
  --initial-prompt "只修改 README.md：根据仓库已有内容，澄清一处首次运行说明，让新人少猜一步。不要发明命令，不改代码。检查 git diff --check，并核对改动涉及的命令确实存在。在自己的分支提交，不要 push。最后总结改了什么、检查结果和疑问。"
```

### 4. 看它干得怎么样

用第一条命令查看进度：`running` 表示运行中，`awaiting-review`（待审阅）表示已有提交、工作树干净，可以检查结果。
不想反复查就用第二条：它会一直等到工人做完，然后把工人的最终回答打印出来。

```bash
octogent terminal list
octogent terminal wait first-worker
```

### 5. 审阅、合并、收尾

先看差异，满意后再合并；最后一行会关闭会话并删除终端记录、工作树和分支。
主分支不叫 `main` 就换成你的。
合并时若打开编辑器，保存并退出即可完成合并。

```bash
git diff main..octogent/first-worker
git merge --no-ff octogent/first-worker
octogent terminal delete first-worker --with-worktree
```

## 第二部分：速查表

`<触手ID>`、`<终端ID>`、`<项目ID>` 和 `<任务书>` 要换成实际值，尖括号也要去掉。Git 示例假设主检出目录当前在 `main`；若用其他分支，替换 `main`。默认工作树 ID 与终端 ID 相同。表中创建命令会创建新终端。

| 想做什么 | 确切命令 |
| --- | --- |
| 建触手 / 查触手 ID | `octogent tentacle create api-work --description "API 工作"` / `octogent tentacle list` |
| 派给 Claude Code | `octogent terminal create --name "API 工人" --tentacle-id <触手ID> --workspace-mode worktree --agent-provider claude-code --initial-prompt "<任务书>"` |
| 派给 Codex | `octogent terminal create --name "API 工人" --tentacle-id <触手ID> --workspace-mode worktree --agent-provider codex --initial-prompt "<任务书>"` |
| 按档位选模型 | `octogent terminal create --tentacle-id <触手ID> --workspace-mode worktree --agent-provider codex --effort heavy --initial-prompt "<任务书>"`；档位为 `light`、`standard`、`heavy`、`max` |
| 指定模型 | `octogent terminal create --tentacle-id <触手ID> --workspace-mode worktree --agent-provider claude-code --model sonnet --initial-prompt "<任务书>"` |
| 列终端 / 查归档记录 | `octogent terminal list` / `octogent terminal list --archived` |
| 看工人的活动转录 | `tail -n 40 ~/.octogent/projects/<项目ID>/state/transcripts/<终端ID>.jsonl` |
| 等工人做完并拿到回答 / 随时看回答 | `octogent terminal wait <终端ID>` / `octogent terminal result <终端ID>`（脚本加 `--json`） |
| 追加消息 / 核对是否投递 | `octogent channel send <终端ID> "请补充测试结果和疑问"` / `octogent channel list <终端ID>` |
| 停止 / 归档 / 只删记录 | `octogent terminal stop <终端ID>` / `octogent terminal archive <终端ID>` / `octogent terminal delete <终端ID>` |
| 查看提交和差异 | `git -C .octogent/worktrees/<终端ID> log main..HEAD` / `git diff main..octogent/<终端ID>` |
| 审阅通过后合并 | `git merge --no-ff octogent/<终端ID>` |
| 合并后删记录、工作树和分支 | `octogent terminal delete <终端ID> --with-worktree` |
| 预览 / 回收已归档且已合并的工作树 | `octogent worktree gc --dry-run` / `octogent worktree gc` |
| 批量归档完成记录 / 清掉失效记录 | `octogent terminal archive --all-completed` / `octogent terminal prune` |

## 第三部分：进一步

示例中的 `first-worker` 请换成当前工人 ID；第一部分已删除它。最后一节可独立执行。

### 开始之前与启动检查

- 需要 Node.js 22+、pnpm 10+、Git、`curl` 和已登录的代理；Linux 还需 `node-pty` 编译工具链，见[安装指南](../getting-started/installation.md)。在项目根目录操作，先保存改动、配置 Git 提交身份；工作树只带走已提交版本。
- `octogent init` 创建 `.octogent/` 配置和忽略规则；`octogent` 启动服务，未初始化时使用临时状态根并显示初始化卡。
- 默认从 `127.0.0.1:8787` 找空闲端口，遇占用递增；`OCTOGENT_API_PORT` 或 `PORT` 设置起点。看启动输出的实际地址，已初始化项目的 CLI 会自动读取它。
- 无浏览器用 `OCTOGENT_NO_OPEN=1`；日志重定向到 `mktemp` 创建并打印的文件，便于追查启动、钩子和重试。

```bash
octogent init
octogent_log=$(mktemp)
printf 'Octogent log: %s\n' "$octogent_log"
OCTOGENT_NO_OPEN=1 OCTOGENT_VERBOSE_LOGS=1 octogent >"$octogent_log" 2>&1 &
```

另开窗口验证；端口按启动输出替换，空列表也表示连接成功：

```bash
curl --fail --silent --show-error http://127.0.0.1:8787/api/health
octogent terminal list
```

局域网用下面的启动方式，默认绑定 `0.0.0.0`，`HOST` 可覆盖；CLI 打印含自动生成令牌的访问链接，也可用至少 32 字符的高熵 `OCTOGENT_ACCESS_TOKEN`。令牌可控制项目，含令牌的日志仅给授权者。

```bash
OCTOGENT_NO_OPEN=1 OCTOGENT_ALLOW_REMOTE_ACCESS=1 octogent
```

每个项目选一种启动方式。

### 五句话理解分工

1. octoboss（大章鱼）由人或 AI 协调者分工、审阅：工作分给触手，由终端执行。
2. 触手用 `.octogent/tentacles/<触手ID>/` 下的 `CONTEXT.md`、`todo.md` 等文件保存背景、待办和交接，可供多个终端共用。
3. 终端是执行具体任务的代理会话及记录，触手 ID 指工作线，终端 ID 指执行者。
4. `worktree` 使用隔离工作树和 `octogent/<终端ID>` 分支，适合代码和并行任务；工人提交，协调者审阅合并。
5. `shared` 是共享工作区，直接在主目录工作且被告知不要提交，适合调查和小改动；同时编辑同一文件会冲突。

deck 管理触手文件和待办，详见[心智模型](../concepts/mental-model.md)和[触手](../concepts/tentacles.md)。

### 选择代理、模型和档位

- `--agent-provider claude-code` 或 `--agent-provider codex` 选代理，省略则用服务端默认值。
- `--effort` 默认映射（2026-09-08 更新，`@` 后为 Codex 推理等级）：
  - `light`：`haiku`（Haiku 4.5）/ `gpt-5.6-luna@low`。
  - `standard`：`sonnet`（Sonnet 5）/ `gpt-5.6-sol@medium`，回退 `gpt-5.6-terra@medium`。
  - `heavy`：`opus`（Opus 5）/ `gpt-6-astra@medium`，回退 `gpt-5.6-sol@high`。
  - `max`：`fable`（Fable 5.1）/ `gpt-6-astra@xhigh`，回退 `gpt-5.6-sol@xhigh`。
- GPT-6 按账号开放；按 `$CODEX_HOME/models_cache.json`（默认 `~/.codex/models_cache.json`）选择候选，缓存不可读或无候选时尝试首选。
- `--model sonnet` 或 `--model gpt-5.6-sol` 优先于档位，使用代理默认推理等级，同时传 `--effort` 也不改变这一点。模型标识以字母或数字开头，仅含字母、数字、`.`、`_`、`-`。
- 启动前用 `OCTOGENT_EFFORT_MODELS` 覆盖映射，Codex 支持 `model@reasoning` 和候选数组，见 [CLI 参考](../reference/cli.md)。
- 卡片与 `terminal list` 显示代理、模型（`agent=`、`model=`）；Claude 可从转录学到实际模型，未知时卡片显示“默认模型”，CLI 省略 `model=`。
- Codex 默认：共享模式 `workspace-write`、工作树 `danger-full-access`，可用 `OCTOGENT_CODEX_SANDBOX_MODE` 覆盖；前者将 `.git` 挂为只读，会阻止提交。工作树隔离 Git 改动，不隔离系统权限；`OCTOGENT_CODEX_APPROVAL_POLICY` 默认 `never`，避免卡在批准提示。

### 派活：把任务说明写完整

先建触手，再用 `--name` 命名、`--workspace-mode` 选位置、`--initial-prompt` 派任务；**每次带 `--tentacle-id`**，省略时 CLI 提示直属 octoboss，已有触手不会自动关联。

任务书包含：

- 目标和原因。
- 确切文件或区域。
- 所需行为清单。
- 要加的测试，或文档核对方式。
- 门禁：本仓库 API 任务用 `pnpm --filter @octogent/api test`、`pnpm lint`、`pnpm build`；其他仓库按项目调整。
- 工作树任务“在自己的分支提交，不要 push”；共享任务“不要提交”。
- 结束时总结、疑问、未完成和未验证项。

本仓库的完整文档任务示例，名称需未被使用：

```bash
octogent tentacle create install-docs --description "让安装后的第一次启动更明确"
octogent_brief=$(cat <<'TASK'
目标和原因：让刚安装好的用户知道怎样验证 Octogent 已经运行，减少猜测。
范围：只修改 docs/getting-started/installation.md 的 First run behavior 部分。
所需行为：
- 根据 apps/api/src/cli.ts 核对直接启动与 octogent init 的区别，修正不一致的说明。
- 说明端口可能递增，应看启动输出的地址。
- 补充用 /api/health 和 octogent terminal list 验证启动的方法。
验证：这是文档任务，不新增代码测试；逐条对照 CLI 源码，检查所有链接和命令。
门禁：运行 git diff --check 和 pnpm lint；如无法运行，说明原因，不要宣称通过。
在自己的分支提交，不要 push。不要改其他文件。
最后总结改动、验证结果和疑问，列出未验证项。
TASK
)
octogent terminal create --name "核对安装说明" --tentacle-id install-docs \
  --workspace-mode worktree --agent-provider claude-code --effort standard \
  --initial-prompt "$octogent_brief"
```

- 钩子是代理报告启动、工具调用和回合结束的回调；`SessionStart` 触发初始任务投递，启动命令后 15 秒兜底，`UserPromptSubmit` 确认收到。
- 有就绪钩子但 10 秒无确认时重试一次，再过 10 秒显示 `initial prompt not acknowledged`；无就绪钩子不重试，防止重复任务。此提示是原因字段，晚到的确认会清除它。
- 先查终端和日志、处理登录/更新/信任提示，确认任务未开始后用 `channel send` 重发。

### 跟进进展：看状态，也看证据

- `octogent terminal list`：ID、生命周期、名称，以及已知的 `pid=`、`agent=`、`model=`、`reason=`。
- `running`：运行中；`stalled`（停滞）：会话存活，但超过 `OCTOGENT_TERMINAL_STALL_MS`（默认 120000 毫秒）无活动。任务提交、工具调用、输出均计入，输出按几秒节流；检查是否在等输入。
- `awaiting-review`：干净工作树有基线之外的未合并提交；`completed`（已完成）：工作树产出已合并，或共享工人结束一轮。新活动可回到 `running`。
- `stopped`：会话关闭；`exited`：进程退出；`stale`：重启后旧记录无法接回会话。
- flow view（进度页）看分工，连线反映活动；canvas（代理页）打开终端看输出和总结。Codex 对话页暂无完整转录回放。

默认转录：`~/.octogent/projects/<项目ID>/state/transcripts/<终端ID>.jsonl`；项目 ID 在 `.octogent/project.json`，覆盖过状态目录则用实际路径：

```bash
octogent_project_id=$(node -p "JSON.parse(require('node:fs').readFileSync('.octogent/project.json', 'utf8')).projectId")
tail -n 40 "$HOME/.octogent/projects/$octogent_project_id/state/transcripts/first-worker.jsonl"
```

事件：`session_start` 会话开始、`state_change` 状态变化、`tool_use` 工具调用、`session_end` 会话结束；记录活动而非完整输出，长回合以 `tool_use` 持续记录，无需重复 `processing`。

### 给运行中的工人追加消息

channel（消息）用于追加要求或询问进展：

```bash
octogent channel send first-worker "请说明你核对了哪些命令；有疑问先告诉我。"
octogent channel list first-worker
```

- `send` 回显 delivered（已写入终端）或 queued（忙时排队，空闲投递）；`list` 对应 `status=delivered` / `status=pending`。
- 代发加 `--from <发送方终端ID>`，省略则取环境中的 `OCTOGENT_SESSION_ID`（若存在）。
- 带初始任务的工人默认跨回合保活；工作树 `completed` 且已合并时释放，`awaiting-review` 保持会话。
- `terminal stop` 立即关闭；归档释放保活，之后按 `OCTOGENT_TERMINAL_IDLE_GRACE_MS`（默认五分钟）关闭。`OCTOGENT_TERMINAL_RETENTION_HOURS`（默认 72 小时）归档符合条件的 `completed`、`stopped`、`exited`，待审阅不自动归档。
- `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN=1` 恢复每轮释放保活。服务重启会断开会话、丢失内存消息；重要交接写入触手文件，见[代理间消息传递](inter-agent-messaging.md)。

### 审阅、测试、合并和清理

在主目录读总结、提交和差异，在工作树测试改动；以下基线为 `main`，代码任务使用本仓库门禁：

```bash
git -C .octogent/worktrees/first-worker status --short
git -C .octogent/worktrees/first-worker log --oneline main..HEAD
git diff main..octogent/first-worker
git -C .octogent/worktrees/first-worker diff --check main..HEAD
# 以下门禁适用于 Octogent 仓库的 API 代码任务。
(
  cd .octogent/worktrees/first-worker
  pnpm install && pnpm --filter @octogent/api test && pnpm lint && pnpm build
)
```

有问题发消息修正；通过后合并，解决冲突并复查组合结果，再清理：

```bash
git merge --no-ff octogent/first-worker
# 合并与组合结果检查都通过后再清理。
octogent terminal stop first-worker
octogent terminal delete first-worker --with-worktree
```

- `delete --with-worktree` 会关闭会话，现场检查相对主目录当前分支的未合并提交，拒删其他终端仍引用的工作树；`--force` 可绕过未合并警告。删除父终端会连带子终端，需审阅整条链。
- `terminal archive <终端ID>` 隐藏记录、保留转录和总结，可能立即回收已合并工作树；运行中不能归档，先停止。
- `worktree gc --dry-run` 预览，`worktree gc` 回收已归档且已合并的工作树和分支；现场 Git 判定优先，未提交或未合并时保留，Git 无法回答才读记录，共用工作树须所有记录符合条件。
- `terminal delete <终端ID>` 默认保留工作树；`terminal prune` 只删 `stale`、`stopped`、`exited` 记录。需要回收磁盘时先归档、gc，再删记录。

**未合并工作不应自动删除；归档回收和 gc 遵守此规则，临时直属终端清理有例外：**

- 无持久触手文件夹、父子会话均关闭、顶层为 `completed` / `stopped` / `exited` / `stale` 的直属终端，会在下一次顶层派发时被删，并尝试删除工作树和分支，**不检查合并**；先审阅合并，再停止和派下一批。
- 持久触手走归档回收；仍开着会话的工人无论忙闲都受下一批清理保护。有产出的任务挂到持久触手下。

### 分批和并行派发

- 每条工作线一个触手；多次 `terminal create` 派出的工人并行运行，分清文件范围，代码用工作树，逐个审阅合并。
- 父终端负责分工审阅，子终端执行；创建子终端带 `--parent-terminal-id <父终端ID>` 和 `--tentacle-id`，每个父终端最多 9 个子终端。
- 服务默认最多 32 个活动会话；启动前用 `OCTOGENT_MAX_TERMINAL_SESSIONS` 按主机资源和账号额度调整。
- deck 用 `todo.md` 复选框启动单项求解或 swarm（多工人协作）；执行中保持顺序，审阅后勾选。详见[使用待办事项](working-with-todos.md)和[编排子代理](orchestrating-child-agents.md)。

### 协调者工作法：派发 → 等待 → 读回答 → 追问 → 审阅 → 收尾

这一节写给“派活的人”——既可以是你自己，也可以是一个通过 shell 调用命令的 AI 协调者（Claude Code 或 Codex 会话）。协调者本身不必是 Octogent 终端；下面每一步都只用 CLI，不需要浏览器，也不需要自己去接 API 或 WebSocket。

1. **派发**：先 `octogent tentacle create`，再为每个工人 `octogent terminal create`，**总是带 `--tentacle-id`**，并用 `--terminal-id` 给工人起一个你后面直接引用的 ID。任务书里写明成果交付在哪里：建议让工人把结论写到 `.octogent/tentacles/<触手ID>/RESULT.md`，并在最后一句回答里给出路径。
2. **等待**：`octogent terminal wait <工人ID> [<工人ID>...] --timeout 600`。它阻塞到工人尘埃落定，打印每个工人的状态、摘要和最终回答；退出码 0 表示都到了待审阅或已完成，1 表示有工人以其他方式结束，2 表示超时（会话仍在，可继续等）。
3. **读回答**：`octogent terminal result <工人ID>` 随时打印同样的结果块；脚本用 `--json`。回答里提到的文件（如 `RESULT.md`）自己读。
4. **追问**：`octogent channel send <工人ID> "..."`。带初始任务的工人回合结束后仍保持会话，消息在它空闲时投递（`send` 会回显已投递或已排队）；然后再次 `wait` 拿新回答。
5. **审阅与合并**：工作树任务看分支——`git diff main..octogent/<工人ID>`，通过后 `git merge --no-ff octogent/<工人ID>`；共享工作区任务直接看它改动的文件。
6. **收尾**：每个工人都由你主动结束——`octogent terminal delete <工人ID> --with-worktree`（已合并时）或 `octogent terminal stop <工人ID>`。工人不会自己退出，服务默认最多 32 个并发会话。

协调者常犯的错：

- 忘了 `--tentacle-id`，所有工人挂在大章鱼下面。
- 自己去接终端的 WebSocket 或轮询 `/api/terminal-snapshots` 来判断是否完成——用 `terminal wait` 就够了。
- 把 `stalled` 当成进程已死而重派同一任务；先 `terminal result` 看它最后说了什么。
- 期待工人用 channel “回信”给不是 Octogent 终端的协调者——回答要用 `terminal result` 读。
- 派了下一批却没有停止上一批，会话越积越多。

### 试用中遇到的坑：现象 → 原因 → 处理

依据 2026-09-05 至 09-08 的 DEIMv2、DiveoDevOps 试用记录：

- **工人挂在大章鱼下** → 漏 `--tentacle-id` → 每次传 ID；CLI 已增加直属提示。
- **`npm install` 报依赖错误** → 本仓库用 pnpm workspace → 根目录运行 `pnpm install`，旧依赖按[安装指南](../getting-started/installation.md)清理；`npm install -g .` 用于全局安装 CLI。
- **Claude 提交后仍不进入待审阅** → 旧版把未忽略的 `.claude/` 钩子当作改动 → 当前完成检测忽略 `.claude/settings.json`，安装器将该文件加入 Git `info/exclude`；检查其他未提交文件。
- **工具记录不更新** → 钩子可能未到 → 启动时开 `OCTOGENT_VERBOSE_LOGS=1`，看 `[Hook] Received hook`；检查代理目录 `.claude/settings.json` 或用户级 `$CODEX_HOME/hooks.json`（默认 `~/.codex/hooks.json`），以及登录、信任提示。
- **同时创建的工人沉默** → 旧版四秒固定投递早于输入就绪 → 已改 `SessionStart`、15 秒兜底和一次重试；查 `reason=initial prompt not acknowledged`、重试日志，确认任务未开始后重发。
- **`channel list` 少消息** → 先查后发，或把初始任务、回答当消息 → 确认 `send` 成功并查询同一服务；重启前的消息不保留。
- **见 `stalled` 就重复派活** → 把无活动当退出 → 查终端、转录和 `reason=`；当前工具调用和输出均刷新活动，静默也可能在等输入。
- **首轮后五分钟关闭** → 旧版每轮释放保活 → 当前默认跨回合保持，检查 `OCTOGENT_TERMINAL_RELEASE_AFTER_TURN=1`；结束时主动 `terminal stop` 或归档。
- **重启杀错进程或服务自行重启** → 工人 PID、服务 PID、父进程混淆 → 从全局项目目录的 `state/runtime.json` 找服务 PID，用 `ps -o pid,ppid,args -p <服务PID>` 查它和父 PID；systemd 按[服务指南](../reference/systemd.md)操作。先收尾工人；后端更新构建后需重启生效。
- **账号间 GPT-6 可用性不同** → 模型列表不同 → 用 `--effort` 按本地缓存回退、查 `model=`；显式 `--model` 需账号可用，不走档位回退。

### 继续查阅

- [CLI 参考](../reference/cli.md)、[故障排查](../reference/troubleshooting.md)。
- [文件系统布局](../reference/filesystem-layout.md)、[API 参考](../reference/api.md)。
- [使用待办事项](working-with-todos.md)、[编排子代理](orchestrating-child-agents.md)、[代理间消息传递](inter-agent-messaging.md)。

### 完整的无浏览器协调者示例

人在 Bash 或 AI 协调者的同一个 shell 中逐段执行。准备有 `README.md`、提交身份已配置的干净仓库，登录两个代理，使用默认状态目录且无 API 地址覆盖；项目尚未启动服务。

第一段：保存日志、等服务就绪、建触手、派两个互不重叠的文档任务。

```bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
test -f README.md
test -z "$(git status --porcelain)"
octogent_base=$(git branch --show-current)
test -n "$octogent_base"
octogent init
git add .gitignore
git diff --cached --quiet || git commit -m "chore: ignore Octogent workspace"
octogent_log=$(mktemp)
nohup env OCTOGENT_NO_OPEN=1 OCTOGENT_VERBOSE_LOGS=1 octogent >"$octogent_log" 2>&1 < /dev/null &
octogent_server_pid=$!
printf 'Service PID: %s; log: %s\n' "$octogent_server_pid" "$octogent_log"
octogent_project_id=$(node -p "JSON.parse(require('node:fs').readFileSync('.octogent/project.json', 'utf8')).projectId")
octogent_state="$HOME/.octogent/projects/$octogent_project_id/state"
octogent_ready=0
for octogent_attempt in {1..30}; do
  if test -f "$octogent_state/runtime.json"; then
    octogent_api=$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).apiBaseUrl" "$octogent_state/runtime.json")
    octogent_metadata_pid=$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).pid" "$octogent_state/runtime.json")
    if test "$octogent_metadata_pid" = "$octogent_server_pid" && curl --fail --silent --show-error "$octogent_api/api/health"; then
      octogent_ready=1
      break
    fi
  fi
  sleep 1
done
if test "$octogent_ready" != 1; then
  cat "$octogent_log"
  exit 1
fi
octogent terminal list
octogent_batch="docs-batch-$(date +%s)-$$"
octogent_claude="$octogent_batch-claude"
octogent_codex="$octogent_batch-codex"
octogent tentacle create "$octogent_batch" --description "核对首次运行说明和本地目录忽略规则"
octogent terminal create --terminal-id "$octogent_claude" --name "说明文档工人" \
  --tentacle-id "$octogent_batch" --workspace-mode worktree \
  --agent-provider claude-code --effort standard \
  --initial-prompt "只修改 README.md，依据仓库实际配置澄清一处首次运行说明，方便新人启动。不要发明命令，不改代码。核对涉及的命令，运行 git diff --check。在自己的分支提交，不要 push。最后总结改动、验证和疑问。"
octogent terminal create --terminal-id "$octogent_codex" --name "忽略规则说明工人" \
  --tentacle-id "$octogent_batch" --workspace-mode worktree \
  --agent-provider codex --effort light \
  --initial-prompt "只修改 .gitignore：在现有 .octogent 忽略规则旁补一句注释，说明它保存本地代理配置和工作树，不应提交这些运行文件。保持所有忽略规则语义不变。运行 git check-ignore .octogent/project.json 和 git diff --check 验证。在自己的分支提交，不要 push。最后总结改动、验证和疑问。"
```

第二段：追加要求，然后等两名工人做完并打印它们的最终回答，最多等十分钟；超时（退出码 2）时会话仍在，查日志和转录后续作。

```bash
octogent terminal list
octogent channel send "$octogent_claude" "补充要求：请在提交说明中列出核对过的命令及依据文件，方便无浏览器审阅。"
octogent channel list "$octogent_claude"
octogent terminal wait "$octogent_claude" "$octogent_codex" --timeout 600
```

第三段：对照任务书和补充要求审阅；以下是文档门禁，代码任务改用工作树中的项目测试（本仓库为 API 测试、lint、build）。

```bash
for octogent_worker in "$octogent_claude" "$octogent_codex"; do
  git -C ".octogent/worktrees/$octogent_worker" status --short
  test -z "$(git -C ".octogent/worktrees/$octogent_worker" status --porcelain)"
  git -C ".octogent/worktrees/$octogent_worker" log "$octogent_base..HEAD"
  git diff "$octogent_base..octogent/$octogent_worker"
  git -C ".octogent/worktrees/$octogent_worker" diff --check "$octogent_base..HEAD"
done
git -C ".octogent/worktrees/$octogent_codex" check-ignore .octogent/project.json
```

审阅通过后执行最后一段；有问题先 `channel send` 修正并复查。冲突或检查失败会停止执行、保留工作树；结束后服务和日志保留。

```bash
test "$(git branch --show-current)" = "$octogent_base"
test -z "$(git status --porcelain)"
octogent_review_base=$(git rev-parse HEAD)
git merge --no-ff "octogent/$octogent_claude" -m "docs: merge reviewed startup clarification"
git merge --no-ff "octogent/$octogent_codex" -m "docs: merge reviewed ignore-rule explanation"
git diff --check "$octogent_review_base..HEAD"
git check-ignore .octogent/project.json
for octogent_worker in "$octogent_claude" "$octogent_codex"; do
  git merge-base --is-ancestor "octogent/$octogent_worker" HEAD
  octogent terminal stop "$octogent_worker"
  octogent terminal delete "$octogent_worker" --with-worktree
done
octogent worktree gc --dry-run
octogent terminal list
```
