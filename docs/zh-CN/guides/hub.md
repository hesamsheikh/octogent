# 通过 hub 运行 Octogent

hub 是整台机器上所有项目共用的一个 Octogent 服务器：一个进程，一个固定地址 `http://127.0.0.1:8787`。每个已注册项目的仪表盘在 `/p/<slug>/`，`/` 是所有项目的总览，附带各项目运行中和待审阅的终端数。在项目目录里运行的 CLI 命令会经由 hub 到达该项目。项目在第一次被请求时加载，连续 30 分钟既没有会话也没有请求就会被卸载（`OCTOGENT_HUB_PROJECT_IDLE_MS`；设为 `0` 则一直保持加载）。卸载后所有内容仍在磁盘上，下一次请求会重新加载它。项目状态的位置不变：项目里的 `.octogent/` 和 `~/.octogent/projects/<id>/`。

## 1. 启动 hub

1. **自动启动。** 在项目目录里运行 `octogent`。没有 hub 响应时它会启动一个，需要时注册项目，然后打开项目页面：

   ```bash
   cd ~/code/my-app
   octogent
   # my-app 的 Octogent 仪表盘：http://127.0.0.1:8787/p/my-app/
   ```

   其他需要服务器的命令（`octogent terminal list`、`octogent tentacle create` 等）也会这样启动 hub。`OCTOGENT_NO_AUTOSTART=1` 关闭自动启动，`OCTOGENT_NO_OPEN=1` 不打开浏览器。

2. **手动启动。**

   ```bash
   octogent hub start        # 后台运行；加 --foreground 则留在当前终端
   octogent hub status       # 地址、pid、构建、日志和项目
   octogent hub stop
   ```

3. **作为 systemd 用户服务**（Linux），让 hub 自行启动、崩溃后自动重启：

   ```bash
   octogent hub install-service
   loginctl enable-linger "$USER"    # 仅当它提示 lingering 未开启时
   ```

   装好服务后，每次启动 hub 都经由 systemd。服务从 `~/.octogent/hub.env` 读取变量，而不是从你的 shell。见 [systemd 用户服务](../reference/systemd.md)。

`octogent --standalone` 仍会单独启动一个单项目服务器（从 `8787` 起找空闲端口）。同一个项目二者选一，不要同时运行。

## 2. 项目

1. **注册**项目：在 git 仓库里运行 `octogent`（或任何需要服务器的命令）；或在那里运行 `octogent init`（它还会写入 `.gitignore` 和 `.octogent/env`）；或使用总览页上的表单。
2. **列出**项目：

   ```bash
   octogent projects
   # * my-app   My App   3f1c…   /home/ada/code/my-app
   ```

3. **slug** 由项目名称生成：转成小写，其他字符连成的一段变成 `-`（`My App` → `my-app`）。重名时加 `-2`、`-3`……；项目改名后，旧 slug 仍然有效。
4. **页面：** `http://127.0.0.1:8787/` 是总览，`http://127.0.0.1:8787/p/<slug>/` 是单个项目。顶栏左侧的切换器可在项目之间跳转。
5. **在任意目录**用 `--project <slug>` 指定项目：

   ```bash
   octogent --project my-app                 # 打开它的页面
   octogent terminal list --project my-app
   ```

## 3. 工作代理的环境

工作代理不继承启动 hub 的那个环境（可能是另一个 shell，也可能是 systemd）。每个工作代理拿到一份基线环境（`HOME`、`PATH`、语言区域、代理设置、代理 CLI 自己的变量等），再加上：

1. **按项目、持久生效：** `<项目>/.octogent/env`，每行 `KEY=VALUE`。每次会话启动时都会重新读取，不需要重启任何东西。Python 项目通常需要：

   ```bash
   # .octogent/env
   PATH=$PWD/.venv/bin:$PATH
   VIRTUAL_ENV=$PWD/.venv
   ```

2. **按终端：** `--inherit-env` 从创建终端的 shell 传入指定变量：

   ```bash
   octogent terminal create --inherit-env AWS_PROFILE,DATABASE_URL -p "…"
   ```

完整的顺序和规则见[工作代理的环境](../reference/cli.md#工作代理的环境)。

## 4. 升级

```bash
cd ~/src/octogent          # 安装 Octogent 时用的那个检出目录
git pull
pnpm install
pnpm build
octogent hub restart
```

只要任何项目有 `running` 或 `awaiting-review` 的终端，`hub restart` 就会拒绝并列出它们，因为这些会话会随 hub 一起结束。等它们结束（或停止它们）后再运行，或加 `--force`。在 hub 重启之前，命令会提示一次它运行的是较旧的构建。装了 systemd 服务时，重启同样经由 systemd。

## 5. 故障排查

1. 先看 `octogent hub status`：hub 是否响应、运行哪个构建、加载了哪些项目。
2. 日志：`~/.octogent/hub/logs/server.log`（`octogent logs` 显示的是当前项目自己的服务日志）。启动阶段的崩溃写入 `~/.octogent/hub/logs/daemon-stderr.log`；在 systemd 下则看 `journalctl --user -u octogent-hub`。
3. `port 8787 is taken by pid …`：旧的单项目服务器占着端口。见[端口 8787 被旧的单项目服务器占用](../reference/troubleshooting.md#端口-8787-被旧的单项目服务器占用)。
4. `the hub is running an older build`：见[hub 运行的是较旧的构建](../reference/troubleshooting.md#hub-运行的是较旧的构建)。
5. 工作代理找不到 `python`、`node` 或其他工具：见[故障排查](../reference/troubleshooting.md)中对应的一节。
6. 从其他机器访问：只有同时设置 `OCTOGENT_ALLOW_REMOTE_ACCESS=1` 和至少 32 个字符的 `OCTOGENT_ACCESS_TOKEN`，hub 才会绑定 `127.0.0.1` 之外的地址；两者都要设置在 hub 启动的环境里（服务则写进 `hub.env`）。见[运行 hub](../reference/cli.md#运行-hub)。
