# 以 systemd 用户服务运行 Octogent

本指南介绍如何在 Linux 机器上使用 systemd 用户服务让 Octogent 常驻后台运行。可直接修改的示例 unit 文件位于 [`examples/octogent.service`](../../../examples/octogent.service)。

## 安装步骤

1. 找到 `octogent` 启动器的绝对路径。systemd 不会加载你的 shell 配置文件，因此 unit 不能依赖 `PATH`：

   ```bash
   which octogent
   ```

2. 将示例 unit 复制到用户 unit 目录：

   ```bash
   mkdir -p ~/.config/systemd/user
   cp examples/octogent.service ~/.config/systemd/user/octogent.service
   ```

3. 编辑 `~/.config/systemd/user/octogent.service`：

   - 将 `ExecStart=/absolute/path/to/octogent` 替换为第 1 步得到的路径。
   - 将 `WorkingDirectory=%h/your-project` 替换为希望仪表盘管理的项目目录。
   - 按需取消注释 `OCTOGENT_ALLOW_REMOTE_ACCESS=1` 或 `OCTOGENT_API_PORT` 对应的 `Environment=` 行（全部受支持的变量见 [CLI 参考](cli.md)）。

4. 重新加载 unit 并启动服务：

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now octogent
   ```

5. 确认运行状态：

   ```bash
   systemctl --user status octogent
   ```

## 开机自启

默认情况下，systemd 用户服务只在你有活跃登录会话时运行。要让 Octogent 在开机时启动、并在你注销后继续运行，需要为你的用户启用 lingering：

```bash
loginctl enable-linger "$USER"
```

未启用 lingering 时，服务会在你首次登录时启动，并在最后一个会话结束时停止。

## 查看日志

服务输出会写入 systemd journal：

```bash
journalctl --user -u octogent -f
```

去掉 `-f` 可以分页浏览历史日志，而不是实时跟随输出。

## systemd 与守护脚本的取舍

两种方式都能让 Octogent 保持运行，按你的环境选择：

- **systemd 用户服务**（本指南）：进程被直接监管——崩溃后数秒内自动重启（`Restart=on-failure`、`RestartSec=3`），日志进入 journal，启动/停止/查看状态都用标准的 `systemctl --user` 命令。在任何带 systemd 的 Linux 主机上优先选择这种方式。
- **守护脚本**（cron 或轮询 `GET /api/health` 的循环脚本，见 [API 参考](api.md)）：适用于没有 systemd 用户服务的环境（容器、macOS、精简镜像），并且可以叠加进程存活之外的自定义健康检查逻辑。代价是重启检测更慢（依赖轮询间隔而非即时监管），日志处理也需要自行搭建。

## 常见问题

### nvm 环境下出现 `status=127` 或 "command not found"

nvm 把 Node 和全局包安装在 `~/.nvm/versions/node/<version>/bin` 下，该目录由 shell 配置文件加入 `PATH`——systemd 完全看不到它。必须保证两处都能解析：

1. `ExecStart` 必须使用 `which octogent` 打印的绝对路径。
2. 启动脚本本身以 `#!/usr/bin/env node` 开头，因此 `node` 也必须能被找到。取消注释 unit 中的 `Environment=PATH=...` 行，并把 `which node` 打印的目录加进去。

编辑 unit 后，运行 `systemctl --user daemon-reload` 并重启服务。注意：`nvm use`/`nvm install` 切换 Node 版本会改变这些路径，升级 Node 后需要同步更新 unit。

### 端口被占用

如果 journal 中出现 bind 错误，说明另一个进程（通常是手动启动的 `octogent`）已占用该端口（默认：`8787`）。可以停掉那个进程，或取消注释 unit 中的 `Environment=OCTOGENT_API_PORT=...` 改用其他端口，然后 `daemon-reload` 并重启服务。

> 本文件是 [../../reference/systemd.md](../../reference/systemd.md) 的中文翻译版本。如有歧义，以英文原文为准。
