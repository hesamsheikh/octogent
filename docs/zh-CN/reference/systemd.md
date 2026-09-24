# 以 systemd 用户服务运行 hub

在 Linux 上，可以让 systemd 替你运行 [hub](../guides/hub.md)。这样它会在你登录时启动（开启 lingering 后则在开机时启动），崩溃后自动恢复，日志同时写入 journal 和 `~/.octogent/hub/logs/server.log`。

## 安装

1. 先构建检出目录；服务运行的是构建后的 CLI：

   ```bash
   cd ~/src/octogent && pnpm build
   ```

2. 可选：现在就写好 `~/.octogent/hub.env`（见[环境变量](#环境变量)）；unit 始终引用它，之后再补也可以。
3. 在正常的登录 shell 中安装，即 `which claude`（或 `which codex`）能找到命令的 shell：

   ```bash
   octogent hub install-service
   ```

   它会写入 `~/.config/systemd/user/octogent-hub.service`（遵循 `$XDG_CONFIG_HOME`），执行 `systemctl --user daemon-reload` 和 `systemctl --user enable --now octogent-hub.service`，并在 lingering 未开启时提示你。
4. 检查：

   ```bash
   systemctl --user status octogent-hub
   octogent hub status
   ```

没有 systemd 的环境（macOS、大多数容器、没有用户管理器的 `su`/`sudo` shell）中，该命令会报错说明原因，且不写入任何文件；这些环境请改用 `octogent hub start` 启动 hub。如果安装时已有 hub 在运行（例如由 `octogent` 启动的），服务自己的 hub 会让开；等那个 hub 的工作代理空闲后，`octogent hub restart` 会把 hub 迁到 systemd 下。

## unit 的内容

```ini
[Unit]
Description=Octogent hub
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
ExecStart=/home/ada/src/octogent/bin/octogent hub start --foreground
WorkingDirectory=/home/ada
Environment="PATH=/home/ada/.nvm/versions/node/v22.9.0/bin:/home/ada/.local/bin:/usr/bin:/bin"
Environment="OCTOGENT_HOME=/home/ada/.octogent"
EnvironmentFile=-/home/ada/.octogent/hub.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

- `ExecStart` 是执行 `install-service` 的那个检出目录里的启动器。
- `WorkingDirectory` 是你的主目录，长期运行的 hub 因此不会占住任何项目目录。
- `PATH` 是安装时 shell 的 `PATH`，并把当前 Node 所在目录放在最前。systemd 不读取任何 shell 配置文件，而启动器需要 `node`，hub 的代理需要 `claude`、`codex` 和 `git`。
- `OCTOGENT_HOME` 是 hub 服务的状态根目录。CLI 也靠它认出这个 unit 属于自己的 hub。
- `EnvironmentFile=-…` 始终存在；`-` 表示 `hub.env` 不存在也没关系。
- `Restart=on-failure` 在 hub 崩溃 3 秒后重启它；2 分钟内连续 5 次启动失败（例如端口一直被占）后，systemd 不再重试。

移动检出目录、切换 Node 版本（nvm）或修改 `PATH` 之后，再运行一次 `octogent hub install-service`，然后用 `octogent hub restart` 让它生效。新建或修改 `hub.env` 只需 `octogent hub restart`。[`examples/octogent-hub.service`](../../../examples/octogent-hub.service) 是同一个 unit，供手动安装使用。

## 环境变量

服务里的 hub 看不到你 shell 中的变量。把它需要的变量写进 `~/.octogent/hub.env`，每行一个 `KEY=value`；文件里有令牌时注意设为私有：

```bash
cat > ~/.octogent/hub.env <<'EOF'
OCTOGENT_HUB_PROJECT_IDLE_MS=3600000
OCTOGENT_ALLOW_REMOTE_ACCESS=1
OCTOGENT_ACCESS_TOKEN=replace-with-at-least-32-random-characters
EOF
chmod 600 ~/.octogent/hub.env
octogent hub install-service    # 若缺少 EnvironmentFile 行会补上
octogent hub restart
```

`hub.env` 中的变量会覆盖 unit 中同名的变量。无论 hub 本身以什么环境启动，工作代理都只拿到[工作代理的环境](cli.md#工作代理的环境)中描述的基线。

## 日常命令

- `octogent hub status`、`stop`、`restart` 照常使用。装了 unit 之后，每次启动 hub（`hub start`、`hub restart`、自动启动、直接运行 `octogent`）都会执行 `systemctl --user start octogent-hub`，因此唯一的 hub 就是 systemd 监管的那个。如果 systemctl 拒绝执行，CLI 会给出警告，改为启动一个后台 hub。
- `octogent hub stop` 也能停止服务里的 hub。hub 正常退出，所以 systemd 会让它保持停止，直到下次启动、登录或开机。
- `systemctl --user restart octogent-hub` 同样可用，但它不会像 `octogent hub restart` 那样检查是否有活跃的工作代理。

## 开机启动

除非开启 lingering，systemd 用户服务只在你有登录会话时运行：

```bash
loginctl enable-linger "$USER"
```

不开启 lingering 时，hub 会在你首次登录时启动，在最后一个会话结束时停止。`install-service` 会用 `loginctl show-user` 检查，并在 lingering 未开启时打印这条建议。

## 查看日志

```bash
journalctl --user -u octogent-hub -f
tail -f ~/.octogent/hub/logs/server.log
```

## 移除服务

```bash
octogent hub install-service --remove
```

它会禁用服务、删除 unit 文件并重新加载 systemd。正在运行的 hub 会继续运行，因为它可能还有活跃的工作代理；等它们结束后用 `octogent hub stop` 停止。

## 故障排查

### `status=127`，或启动器找不到 `node`

unit 的 `PATH` 写的是安装时的 Node 目录，nvm 升级后该目录会被删除。在已有新 Node 的 shell 里重新运行 `octogent hub install-service`，然后执行 `octogent hub restart`。

### "the hub cannot start without the tools listed above"

`claude` 或 `codex` 不在 unit 的 `PATH` 上。在 `which claude`（或 `which codex`）能找到命令的 shell 中重新安装，或在 `hub.env` 里用 `PATH=` 行补上所在目录。

### 端口已被占用

journal 中出现 `port 8787 is taken by pid …`：有单项目服务器（`octogent --standalone`，或 hub 出现之前启动的服务器）占着端口。停掉它，或在 `hub.env` 中设置 `OCTOGENT_HUB_PORT`。连续 5 次启动失败后，systemd 会停止尝试，直到你清除失败状态：

```bash
systemctl --user reset-failed octogent-hub
systemctl --user start octogent-hub
```

### 没有 systemd

在 macOS 或容器中，运行 `octogent hub start`（后台 hub），或让你自己的进程管理器运行 `octogent hub start --foreground`。用循环或 cron 任务轮询 `GET /api/hub/health`，可以在它不再响应时重启它。
