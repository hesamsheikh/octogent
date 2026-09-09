# Octogent 文档

本文档面向贡献者和未来的编码代理编写。它解释了 Octogent 的构建方式、状态存储位置以及本地终端代理的协调方式。

Octogent 包含三个主要层次：

- **面向代理的文件**位于 `.octogent/tentacles/<tentacle-id>/`，用于保存上下文、待办事项和交接说明
- **运行时状态**位于 `~/.octogent/projects/<project-id>/state/`，用于跟踪终端、UI 状态、转录和应用元数据
- **实时会话**位于 API 进程中，WebSocket 连接连接到 PTY 支持的 Claude Code 终端

## 从这里开始

- [用 Octogent 完成第一份工作](guides/getting-work-done.md)：约十分钟走通派发、审阅和合并
- [安装](getting-started/installation.md)
- [快速入门](getting-started/quickstart.md)
- [心智模型](concepts/mental-model.md) 解释了触手、终端、工作树和运行时状态之间的边界

## 概念

- [心智模型](concepts/mental-model.md) 解释了触手、终端、工作树和运行时状态之间的边界
- [触手](concepts/tentacles.md) 解释了基于文件的上下文模型以及 Deck 如何读取它
- [运行时与 API](concepts/runtime-and-api.md) 解释了终端生命周期、WebSocket、钩子、持久化和重启行为

## 指南

- [使用待办事项](guides/working-with-todos.md) 解释了复选框行如何变成进度和工作输入
- [编排子代理](guides/orchestrating-child-agents.md) 解释了父/工作代理的生成、共享模式和工作树模式
- [代理间消息传递](guides/inter-agent-messaging.md) 解释了内存通道队列和投递规则

## 参考

- [CLI](reference/cli.md)
- [文件系统布局](reference/filesystem-layout.md)
- [API](reference/api.md)
- [实验性功能](reference/experimental-features.md)
- [以 systemd 用户服务运行](reference/systemd.md)
- [故障排查](reference/troubleshooting.md)

## 贡献者政策

- [贡献指南](../../CONTRIBUTING.zh-CN.md)

> 本文件是 [../index.md](../index.md) 的中文翻译版本。如有歧义，以英文原文为准。
