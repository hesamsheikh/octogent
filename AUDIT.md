# Octogent 代码与功能审计报告

- 审计日期：2026-09-01
- 审计范围：`packages/core`、`apps/api`、`apps/web`，以及 README、`docs/` 中与实现相关的承诺
- 审计方法：静态代码审阅、调用链追踪、文档与实现交叉核验、构建与测试验证
- 风险口径：P0 为默认或低门槛触发的系统性致命问题；P1 为可造成远程代码执行、持久化前端执行、数据破坏或核心安全边界失效的严重问题；P2 为需特定前提但影响明确的正确性、安全性或可用性问题；P3 为防御性加固和可维护性建议

## 1. 执行摘要

总体评价：项目的产品骨架是扎实的。领域类型集中在 `packages/core`，PTY、WebSocket、Git worktree 和文件持久化基本留在 API 层，React 前端也没有反向侵入服务端；构建和 lint 均通过，现有 API 测试覆盖了不少正常路径。但安全边界和持久化一致性没有达到“可放心开放到 LAN、可承受多实例、可保守接管用户真实 AI 工具配置”的程度。这里的问题不是抽象的“最好再加校验”，而是存在可复现的未鉴权 PTY 控制、存储型 XSS、信任范围扩大、共享 worktree 被误删和状态覆盖。

最重要的三个发现：

1. **LAN 鉴权存在两条实质性绕过路径。** 非 CLI 启动路径可在监听 `0.0.0.0` 时没有 token，而显式 `HOST=0.0.0.0` 又可绕过 `allowRemoteAccess` 的开关；远端客户端伪造 `Host: localhost` 后可进入 API/WS，最终获得 PTY 命令执行能力。
2. **前端把不可信 Markdown 原样变成 HTML。** Agent 输出、Prompt 和 Vault 内容都能注入事件处理器脚本，在 Octogent 同源页面内调用终端/API，属于持久化 XSS。
3. **Codex hook 信任写入过宽。** Octogent 会把共享 `hooks.json` 里所有可哈希的命令 handler 一并写进 Codex 信任数据库，而不是只信任自己安装的 handler；已有第三方或恶意 hook 会被静默批准。

本次未发现符合 P0 定义、在默认配置下可无前提造成全局失陷的问题；这不降低以下 P1 的落地优先级。

## 2. 分级发现清单

### P0 致命

未发现可由当前证据支持的 P0。审计没有把“理论上可能”或依赖多重运维误配的问题拔高到 P0。

### P1 严重

#### P1-1：LAN 访问控制可失效，远端可直达 PTY

- **文件:行号：** `apps/api/src/server.ts:20-22,53-59`；`apps/api/src/createApiServer.ts:38-40`；`apps/api/src/createApiServer/remoteAuth.ts:56-59`；`apps/api/src/cli.ts:237-243`；`apps/api/src/listenHost.ts:19-25`；`apps/api/src/createApiServer/security.ts:29-49`
- **问题描述：** token 的自动生成只发生在 CLI `start` 路径。`server.ts`（包括根目录 `pnpm dev` 使用的入口）允许通过环境变量开启远程监听，却把缺失 token 传入 `createApiServer`；`remoteAuth` 对“没有 token”的处理是直接放行。第二条路径是显式设置 `HOST=0.0.0.0`：`resolveListenHost` 会绑定所有接口，即使 `allowRemoteAccess=false`；此时安全检查依赖客户端可控的 `Host`/`Origin`，而 token 仍为空。远端原始 HTTP/WS 客户端发送 `Host: localhost` 且不带 `Origin` 即可伪装成本地请求。
- **潜在影响：** 未授权用户可读取项目状态、创建终端、连接 WebSocket、向 PTY 写入命令；这不是普通信息泄露，而是宿主用户权限下的远程代码执行。`docs/reference/cli.md:32` 所述“远程模式自动生成 token”只对特定入口成立，容易给运维造成错误安全预期。
- **修复建议：** 把约束放进 `createApiServer`/监听启动的统一入口：只要最终 bind address 非 loopback，就必须有高熵 token，否则拒绝启动；不要以 `allowRemoteAccess` 布尔值代替对实际监听地址的判断。非 loopback 场景禁止 Host 头兜底，Origin 只能作为附加 CSRF 防线。增加 `server.ts`、显式 `HOST=0.0.0.0` 和 WS upgrade 的端到端拒绝测试。

#### P1-2：Markdown 渲染形成存储型 XSS

- **文件:行号：** `apps/web/src/components/ui/MarkdownContent.tsx:32-42`；`apps/web/src/components/ConversationsPrimaryView.tsx:223-241`；`apps/web/src/components/PromptsPrimaryView.tsx:223-235`；`apps/web/src/components/DeckPrimaryView.tsx:165-189,602`
- **问题描述：** `marked.parse` 的结果未经 HTML sanitizer 或禁用原始 HTML，就进入 `dangerouslySetInnerHTML`。调用方展示 Agent 对话、用户 Prompt 和 Vault 文件；例如内容 `<img src=x onerror="fetch('/api/terminals', …)">` 会在操作者浏览页面时执行。
- **潜在影响：** 恶意仓库内容、被提示注入影响的 Agent 输出或共享 Prompt 可在 Octogent 页面同源上下文执行脚本，读取 API 数据、创建/控制终端并持久化攻击载荷。即使 LAN token 为 HttpOnly，脚本仍能借浏览器现有会话发起同源请求。
- **修复建议：** 使用经过维护且配置严格的 sanitizer（白名单标签、属性和 URL scheme），默认移除原始 HTML、事件属性、`javascript:`/危险 data URL；外链补充 `rel="noopener noreferrer"`。用真实渲染测试覆盖 raw HTML、SVG、事件属性、编码后的危险 scheme 和正常 Markdown。

#### P1-3：Codex 信任写入把非 Octogent hook 一并批准

- **文件:行号：** `apps/api/src/codexTrust.ts:168-211,385-392`；`apps/api/src/terminalRuntime.ts:551-560`；`apps/api/tests/codexTrust.test.ts:198-239`
- **问题描述：** `collectHookStateEntries` 遍历共享 `$CODEX_HOME/hooks.json` 中所有可哈希的 command handler，随后全部写入 Codex trust store。终端启动会自动执行该流程，筛选条件不是“由 Octogent 本次安装且完全匹配的 handler”。测试甚至把任意 `one`、`two`、`three` 命令全部受信作为期望行为固化下来。
- **潜在影响：** 用户配置中预先存在的第三方、过期或被篡改 hook 会被 Octogent 静默提升为受信命令，绕过 Codex 原本要求人工确认的边界，并可在后续 Codex 事件中执行任意命令。
- **修复建议：** 安装函数返回 Octogent 实际新增/确认的精确 handler 列表，信任层只哈希该集合；同时校验事件名、命令 argv/URL、工作目录和预期 session 占位符。不要遍历批准整个共享配置。把“保留第三方配置但不批准第三方配置”写成回归测试。

#### P1-4：`tentacles.json` 仅有进程内串行化，多实例会丢状态且崩溃可破坏注册表

- **文件:行号：** `apps/api/src/terminalRuntime.ts:85-94`；`apps/api/src/terminalRuntime/registry.ts:348-414,420-495`；`apps/api/src/projectPersistence.ts:136-157,218-248`
- **问题描述：** 服务启动时一次性把注册表读入内存，之后以整文件覆盖写回。debounce/队列只保证单进程内顺序，没有文件锁、版本比较或跨进程协调；写入还直接落到最终文件，而非临时文件原子 rename。两个 Octogent 实例指向同一项目时，各自基于旧快照写全量 JSON，后写者必然覆盖先写者。进程中断、磁盘满或短写可留下半截 JSON，下一次启动的严格解析会直接抛错。
- **潜在影响：** terminal/tentacle 状态静默回退或消失，归档和 worktree 生命周期判断基于错误快照，严重时整个项目无法启动。全局 `projects.json` 的 read-modify-write 同样会在并发项目启动时丢条目。
- **修复建议：** 明确单项目单 writer 并用锁文件强制，或实现带 revision 的乐观并发控制；持久化使用同目录临时文件、`fsync`、原子 rename，必要时保留最后一份可解析备份。全局项目索引也采用同一策略。增加两个独立进程交错更新和写入中断恢复测试，不能只测同一 runtime 对象。

#### P1-5：删除共享 worktree 的一个终端会拆掉仍在使用的工作树

- **文件:行号：** `apps/api/src/cliTerminalCreate.ts:50-53,96-99`；`apps/api/src/terminalRuntime.ts:662-680,1158-1178`；`apps/api/src/terminalRuntime.ts:344-375`
- **问题描述：** CLI 明确支持多个终端用同一个 `--worktree-id`，GC 分组代码也承认共享 worktree。但删除终端时，只按父子关系做 cascade，随后对每个待删终端无条件调用 `removeWorktree`，没有检查是否仍有未删除 sibling 引用相同有效 `worktreeId`。
- **潜在影响：** 删除一个终端即可移除另一个活跃终端所在目录和分支；未提交或未合并工作可能丢失，仍运行的 PTY 会落在已删除 cwd，后续 Git 操作异常。该路径具有明确的数据破坏结果。
- **修复建议：** 删除前按有效 worktree ID 建立引用计数，只在引用集合全部进入删除集且满足脏工作树/合并策略时才移除；共享 worktree 默认应保留，除非用户显式确认。增加两个非父子终端共享 worktree、删除其一仍可继续工作的 API 回归测试。

### P2 中等

#### P2-1：用户真实配置的接管不够保守

- **文件:行号：** `apps/api/src/terminalRuntime/codexHooks.ts:59-78`；`apps/api/tests/codexHooks.test.ts:90-99`；`apps/api/src/terminalRuntime/hookProcessor.ts:142-162`；`apps/api/src/claudeTrust.ts:41-56`；`apps/api/tests/claudeTrust.test.ts:55-71`；`apps/api/src/codexTrust.ts:447-452`
- **问题描述：** `$CODEX_HOME/hooks.json` 或 workspace `.claude/settings.json` 只要不是合法对象，就被当作空对象并整文件覆盖，原始内容不备份；测试把覆盖损坏 Codex 配置当成正常行为。Claude trust 还会把用户明确设置的 `hasTrustDialogAccepted:false` 翻转为 `true`。Codex/Claude trust 采用临时文件 rename，但没有继承原文件权限，默认 umask 下可能把 `0600` 改成 `0644`。
- **潜在影响：** 一次 Octogent 启动就可能抹掉用户配置、改变明确拒绝的信任决策或放宽敏感配置的本机读取权限；失败并非局限在仓库状态目录，而是污染用户真实工具环境。
- **修复建议：** 非法 JSON 应停止自动修改并提示用户，至少先生成带时间戳备份；只有“字段不存在”时才补默认值，显式 `false` 必须保留。原子写前读取并复用原 mode/owner，新文件使用 `0600`。对已存在配置做最小 JSON patch，并记录 Octogent 自己管理的条目。

#### P2-2：hook 端点把 localhost 当身份，且 Codex permission hook 实际不可达

- **文件:行号：** `apps/api/src/createApiServer/remoteAuth.ts:49-63`；`apps/api/src/createApiServer/miscRoutes.ts:118-148`；`apps/api/src/terminalRuntime/codexHooks.ts:51-57`；`apps/api/src/terminalRuntime/hookProcessor.ts:234-264,295-340,343-438`
- **问题描述：** `/api/hooks/*` 只依赖全局远程鉴权；loopback 永远豁免。hook 对目标会话的身份仅来自可伪造的 `X-Octogent-Session` 或 query 参数，没有每会话 secret、进程绑定或签名。任意本地进程只要知道 session ID，就能伪造 prompt/notification/stop，改变 Agent 状态、名称、完成判定和 transcript。与此同时，Codex 配置安装了 `/api/hooks/permission-request`，但路由正则只接受 `session-start|user-prompt-submit|pre-tool-use|notification|stop`，所以该 handler 永远得到 404，虽然后端处理器已经实现了对应分支。
- **潜在影响：** 本机低信任进程可污染调度状态并诱发错误归档/完成；Codex 等待审批状态则不会按设计进入 UI，状态机与真实 Agent 脱节。在 P1-1 的未鉴权远程启动路径下，这个伪造面还会扩展到 LAN。
- **修复建议：** 为每个 PTY/session 生成独立 hook secret，通过受控环境传入，hook 请求使用 HMAC 或 bearer 校验并限制 payload 大小/事件 schema；session ID 只用于寻址，不能充当认证。把 permission route 纳入白名单，并加“安装出的每个 URL 都能实际路由”的契约测试。

#### P2-3：部分 UI 状态看似保存，实际在请求内或重启后丢失

- **文件:行号：** `packages/core/src/domain/uiState.ts:4-24`；`apps/api/src/createApiServer/uiStateParsers.ts:17-45,257-282`；`apps/api/src/terminalRuntime.ts:911-969`；`apps/api/src/terminalRuntime/registry.ts:79-170`；`apps/api/tests/createApiServer.test.ts:1260-1283`
- **问题描述：** core 契约和 API parser 都接受 `terminalInactivityThresholdMs`、`locale`、`activePrimaryNav`、`navSchemaVersion`。runtime patch 逻辑根本没有赋值前两个字段；后两个虽然会写文件，注册表 reload parser 却不读它们。现有测试只在同一个运行实例中 patch 后 GET，没有覆盖真实重启。
- **潜在影响：** API 返回成功却静默忽略语言和终端阈值，导航状态在服务重启后恢复失败；前端与持久化契约产生“成功但没保存”的欺骗性行为。
- **修复建议：** 为每个公开字段建立单一 schema，并由读、写、patch 共用；不支持的字段从契约删除并返回 4xx，支持的字段必须完整 round-trip。测试需关闭第一个 runtime、从磁盘创建第二个 runtime 再断言全部字段。

#### P2-4：按 tentacle 执行 Git 操作时目标选择不确定

- **文件:行号：** `apps/api/src/terminalRuntime/gitOperations.ts:19-45`；`docs/concepts/mental-model.md:19-24`
- **问题描述：** 一个 tentacle 可以拥有多个 terminal，但 Git 操作仅用 `find` 取第一个匹配记录。若第一个是 shared terminal，会直接报“不支持”；若有多个 worktree worker，则操作落到插入顺序决定的任意分支。API 参数没有 terminal/worktree ID 来消除歧义。
- **潜在影响：** 同一个公开操作对相同 tentacle 可能时而冲突、时而作用于错误分支，导致提交、合并或状态读取对象错误。
- **修复建议：** Git 命令必须以明确 terminal ID 或 worktree ID 寻址；只传 tentacle ID 时，若不是唯一可操作 worktree 就返回包含候选项的 409，而不是选择第一个。

#### P2-5：代码事件和 transcript 查询无边界，历史增长会阻塞 API

- **文件:行号：** `apps/api/src/codeIntelStore.ts:16-44`；`apps/api/src/conversations.ts:249,306-354,455-486`
- **问题描述：** code-intel 事件无限 append，读取时整文件载入；conversation list/search 同步枚举并逐个读取所有 transcript/turn，没有索引、分页前置裁剪或总字节预算。hook 能持续制造事件，项目使用时间越长，单次请求工作量越大。
- **潜在影响：** 一个大仓库或恶意本地 hook 可让 Node 事件循环长时间忙于磁盘读取和 JSON 解析，拖慢 PTY/WS 心跳和所有 API；磁盘也会无上限增长。
- **修复建议：** 设置单文件/单项目保留上限并轮转，写入时建立可增量维护的索引；查询必须分页、流式解析并有字节/时间预算。加大文件基准和上限行为测试。

#### P2-6：监控凭证明文持久化且未强制私有权限

- **文件:行号：** `apps/api/src/monitor/repository.ts:121-152,261-284`
- **问题描述：** X/Twitter provider 的 auth token、ct0、cookie 等完整凭证被写入状态 JSON，写文件时没有显式 `0600`，也没有密钥存储或静态加密。默认权限依赖启动用户的 umask。
- **潜在影响：** 在共享主机、宽松 umask、备份或误共享状态目录场景下，会泄露可复用账户会话；泄露后的权限远超“只读监控”。
- **修复建议：** 优先接入系统 keychain/secret store，状态文件只保存引用；最低限度新建文件强制 `0600`、启动时收紧已有权限、输出和日志统一脱敏，并清楚告知备份边界。

### P3 建议

#### P3-1：shell 命令拼接目前靠“输入恰好受控”，缺少结构性防注入

- **文件:行号：** `apps/api/src/bootstrapCommand.ts:79-91`；`apps/api/src/modelSelection.ts:26-31`；`apps/api/src/terminalRuntime/codexHooks.ts:17-18`；`apps/api/src/terminalRuntime/hookProcessor.ts:67,79,133`
- **问题描述：** `bootstrapCommand` 中 model 已通过安全字符正则，审批/沙箱值也是枚举，本次未找到网络请求参数可直接突破为 shell 注入。真正薄弱的是 hook 命令把 `apiBaseUrl` 直接嵌入双引号 shell 字符串；它通常由内部 host/port 生成，但程序化调用或运维环境值若含 `$()`、反引号或引号，就会在 hook 执行时被 shell 展开。
- **潜在影响：** 当前主要是本地配置/嵌入方输入导致的命令执行，不是远端直接利用，因此列为加固项；未来若 URL 来源扩大，会立刻升级为高风险。
- **修复建议：** 不生成 shell 字符串，改用固定可执行文件加 argv 数组/小型 helper；若 Codex/Claude 配置格式只能接收字符串，则统一使用经过验证的 shell quote 函数，并把 URL 限制为解析后的 `http(s)`、合法 hostname 和整数端口。为包含引号、命令替换符的输入加拒绝测试。

#### P3-2：少数顶层模块已经超过“薄编排”职责

- **文件:行号：** `apps/api/src/terminalRuntime.ts:1-1247`；`apps/web/src/components/CanvasPrimaryView.tsx:1-1571`；`apps/web/src/App.tsx:1-706`；`packages/core/src/i18n/en.ts:3-132`
- **问题描述：** API runtime 和两个 React 顶层模块同时承担大量状态机、持久化触发、视图分支和事件编排，修改一条生命周期容易跨越多种职责。core 虽无框架依赖，但 i18n 中混入了大量 CLI/API/Web 展示文案，领域包的概念边界开始膨胀。
- **潜在影响：** 回归测试难以聚焦，状态字段漏读漏写（P2-3）和共享资源漏判（P1-5）更容易出现；core 未来可能变成所有共享内容的杂物层。
- **修复建议：** 保持公开契约不变，逐步把 registry、worktree ownership、UI state persistence 提取为纯服务；前端按画布状态、布局、交互拆 hook/组件。i18n 至少按 domain/cli/api/web namespace 分离，是否留在 core 由依赖方向决定。

#### P3-3：无客户端保活 PTY 缺少失联兜底

- **文件:行号：** `apps/api/src/sessionRuntime.ts:598-615`；`apps/api/src/terminalRuntime/hookProcessor.ts:430-435`；`apps/api/src/terminalRuntime.ts:1234-1245`
- **问题描述：** prompt 启动的 session 会开启 `keepAliveWithoutClients`，正常 stop hook 才释放。安装的 hook 命令以 `|| true` 吞掉网络/路由失败；若 stop hook 没送达，session 可一直无客户端存活，直到服务整体停止。
- **潜在影响：** 反复失败可耗尽并发终端容量并留下后台 Agent/PTY，产生额外计算成本和不可见副作用。
- **修复建议：** 为无客户端 session 设置可配置最大空闲时间和绝对寿命；结合子进程退出、最后活动时间与 hook 心跳回收，超时前在 UI/日志明确告警。

## 3. 架构评价

`packages/core` 的技术边界目前是合格的。其 `package.json` 没有运行时依赖，源码导入保持在包内类型/纯逻辑范围；未发现 React、Node HTTP、WebSocket、PTY、`fs`、Git/worktree 编排或浏览器 API 进入 core。领域类型、归档策略、完成判定、Agent 状态、provider 定义等可以脱离两端运行，符合框架无关领域层的要求。

应用边界总体清楚：`apps/api` 持有 PTY、进程、HTTP/WS、文件持久化和 Git worktree；`apps/web` 通过 transport/API contract 组织 UI，没有导入 API 实现；两端都依赖 core，未发现 apps 之间的反向源码依赖。服务端 route/bootstrap 也已拆出一批 parser、repository 和 handler，而不是所有代码都挤在 server 入口。

主要架构债务不是“依赖方向错了”，而是职责粒度过粗。`terminalRuntime.ts` 同时知道 session、registry、worktree、hook、完成/归档和 UI 状态，造成 P1-5/P2-3 这类跨资源不变量无人集中维护。前端 `CanvasPrimaryView` 与 `App` 亦承担过多状态。core 的 i18n 同时服务多端虽然仍属纯代码，但把展示层文案放在领域包中，会使“框架无关”逐渐被误解成“任何共享东西都可放 core”。建议以资源所有权和状态事务为拆分轴，而不是为缩短文件机械拆函数。

## 4. 安全面

### remoteAuth 与 LAN 边界

CLI `start --allow-remote-access` 的主路径会生成 token，cookie 也设置了 HttpOnly/SameSite，这是正确方向；但安全性不应取决于调用方是否记得先生成 token。P1-1 的两条旁路说明 remoteAuth 是 fail-open：实际绑定到非 loopback 却没有 token 时仍能启动。必须改成底层统一 fail-closed，并覆盖 HTTP 与 WS。另一个现实限制是 LAN 模式仍是明文 HTTP，token 首次出现在 URL，局域网被动监听者可窃取；文档应建议 TLS 反向代理，并在 TLS 下使用 Secure cookie。

### `/api/hooks/*` 的信任模型

当前模型实质是“能访问 localhost 且知道 session ID，就代表该 Agent”。这对单用户、无不可信本地进程的开发机可工作，但不能作为认证边界。hook 能改变状态、名称、transcript 和完成结果，权限并不低。应使用每 session 随机 secret/HMAC、严格事件 schema、大小和频率限制；远程 token 不能替代 Agent 身份。`permission-request` 被安装但路由拒绝则表明配置和路由没有共享同一事件枚举。

### `bootstrapCommand` 与 `codexHooks` 的 shell 注入面

本次逐项追踪后，`bootstrapCommand` 的网络输入没有可确认的直接注入：model 受 `^[A-Za-z0-9._:-]+$` 约束，sandbox/approval 是服务端枚举，固定 prompt 通过 shell quote。不能据此断言完全没有风险，因为 codex/Claude hook 的 URL 是字符串模板后交给 shell 解释，`apiBaseUrl` 未做 shell escaping。当前来源通常受控，所以定为 P3；正确修复是 argv/helper 或严格 URL 解析加统一引用，而不是继续依赖调用约定。

### codexTrust / claudeTrust 对用户配置的修改

这部分不够保守。优点是尽量 merge 已有对象，信任数据库使用临时文件 rename；缺点是非法 JSON 会被覆盖、显式 Claude 不信任会被翻转、权限位未保留，而且 Codex 信任范围扩大到所有 hooks。对用户 home 下真实配置，默认策略应是“无法理解就不写、明确拒绝就尊重、只管理自己创建的条目、修改前可恢复”，而不是确保自动化尽量继续运行。

## 5. 并发与状态一致性

注册表当前解决的是单进程内写入排序，不是数据一致性。`tentacles.json` 的内存快照加整文件覆盖，在多进程下没有正确结果；直接写目标文件又把进程崩溃转化为持久化损坏。应明确单 writer 锁或引入 revision/CAS，原子写、`fsync` 和恢复副本缺一不可。`projects.json` 也必须纳入同一设计，不能只修项目内文件。

WebSocket/PTY 正常关闭路径总体比持久化更成熟：session cleanup 会清 timer、listener、client、stream 和 PTY 引用，runtime stop 会关闭 session、WS 与周期任务，未发现稳定复现的“每次连接必泄漏”。剩余高概率风险是业务级保活：无客户端 session 在 stop hook 丢失后缺乏 TTL；以及无界 transcript/code-intel I/O 阻塞事件循环，表现上会像 WS/PTY 泄漏或假死。建议用资源上限、空闲回收和压力测试验证，而不是仅靠对象 cleanup 单测。

共享 worktree 是更严重的一致性例外：GC 已按同一 worktree 分组并要求组内记录都满足条件，说明设计者知道共享语义；手动删除路径却没有复用这一不变量。worktree 所有权应成为独立领域服务，删除、归档、GC 和 Git 操作统一从它决策。

## 6. 测试覆盖缺口

现有测试对 parser、完成判定、provider、hook processor、归档和大部分 API 正常路径覆盖不错，但关键缺口与本次发现高度重合：

1. 没有从 `server.ts`/根 `pnpm dev` 启动、非 loopback bind、无 token 的集成测试；也没有 `HOST=0.0.0.0` 加伪造 Host 头的 HTTP/WS 拒绝测试。
2. `MarkdownContent` 没有安全测试；Agent、Prompt、Vault 三个不可信数据源都缺少 raw HTML/XSS 用例。
3. Codex trust 测试把“批准所有现有 handler”当正确行为，缺少只批准 Octogent 自有 handler 的反向断言；Codex/Claude 配置损坏时也没有“拒绝覆盖并可恢复”的测试。
4. hook 测试偏向直接调用 processor，没有检查安装出的 URL 是否都被实际路由接受，也没有伪造/缺失 per-session secret、重放和跨 session 请求测试。
5. registry/project persistence 没有两个独立进程交错写、崩溃中断、磁盘写失败、损坏主文件恢复测试。
6. 没有两个非父子终端共享 worktree 后删除其一的回归测试；Git 操作也没有同一 tentacle 多个 worktree 的歧义测试。
7. UI state 测试没有 runtime 重启 round-trip，因而漏掉四个字段的忽略/丢失。
8. transcript/code-intel 缺少大文件、分页、轮转、并发 append/read 和资源预算测试；无客户端 PTY 缺少 stop hook 丢失后的超时回收测试。

验证实况：`pnpm lint` 通过（301 个文件）；`pnpm build` 通过（Web 与 API 均成功产物构建，Web 主 chunk 有超过 500 kB 的警告）。`pnpm --filter @octogent/api test` 中 36/37 个测试文件、387 个断言通过；`tests/uiStateParsers.test.ts` 在收集阶段因当前 pnpm 安装策略未构建 `node-pty` 原生 `pty.node` 而未执行，重跑结果相同。该项是测试环境前置失败，不是测试断言失败，也不能算该文件通过。

## 7. 功能兑现抽查

| 文档声称的能力 | 结论 | 实现核查 |
| --- | --- | --- |
| 文件驱动的 tentacle/todo 工作流 | **兑现** | `apps/api/src/readDeckTentacles.ts:174-259,287-464,480-539` 实现读取、增删改 todo 与创建 tentacle，路由层有相应测试。 |
| Codex/Claude 多 provider PTY 与浏览器终端 | **部分兑现** | `apps/api/src/terminalRuntime.ts`、`sessionRuntime.ts` 和 WS 协议实现了 provider bootstrap、PTY 和重连；但 Codex `permission-request` hook 被路由拒绝，等待审批状态不能按配置兑现。 |
| 单个 todo solve 与 swarm 并行执行 | **兑现** | `apps/api/src/createApiServer/deckRoutes.ts:403-510` 及后续 swarm 路由确实创建 prompt/worker，并有 `deckRoutes.test.ts` 覆盖主要编排。 |
| parent/child Agent 与 channel 消息 | **兑现** | parent 限额、关系和 channel 消息均有实际 runtime/`channelMessaging` 实现与测试；关系的持久化仍受注册表一致性风险影响，但能力不是占位接口。 |
| 独立/共享 Git worktree 与安全 GC | **部分兑现** | 创建和分组 GC 已实现，GC 会核验归档和完成/合并条件；但手动删除会误删仍被 sibling 使用的共享 worktree，按 tentacle 的 Git 目标也有歧义。 |
| hook 驱动的完成判定、归档和自动命名 | **兑现** | `apps/api/src/terminalRuntime/hookProcessor.ts:295-435` 与 completion/archive 逻辑形成真实闭环，非纯 UI 标记；前提是 hook 成功送达。 |
| LAN 远程访问使用自动 token 防护 | **部分兑现** | CLI 主路径生成并展示 token，remoteAuth 支持 header/query/cookie；`server.ts` 与显式 HOST 路径可在非 loopback 无 token 运行，不能视为完整兑现。 |
| UI 布局、导航、语言与终端阈值持久化 | **部分兑现** | 布局等部分字段可保存，但 `locale`、`terminalInactivityThresholdMs` 被 patch 静默忽略，`activePrimaryNav`、`navSchemaVersion` 重启后丢失。 |

结论：Octogent 的主功能并非“文档先行、实现空壳”，大多数工作流确有代码和测试支撑；问题集中在边界条件恰好也是破坏性最大的地方。上线或开放 LAN 前应先处理 P1-1 至 P1-3；在允许多实例或把 worktree 当作用户工作成果托管前，必须同时处理 P1-4、P1-5。其余 P2 应进入近期里程碑，而不是以“本地开发工具”为由长期接受。
