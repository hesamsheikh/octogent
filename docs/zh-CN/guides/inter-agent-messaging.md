# 代理间消息传递

Octogent 提供一套简单的本地通道系统，用于终端之间传递消息。

## 通道是什么

通道是以目标终端 ID 为键的内存队列。发送消息不会写入目标触手的文件，也不会产生持久化的通知记录。

用它做简短协调：

- 请求评审
- 报告完成
- 交接一个发现
- 提醒另一个代理注意某个文件或风险

它不能替代正规的上下文文件。

## 投递模型

发送消息时，Octogent 会：

1. 校验目标终端记录存在
2. 把消息追加到该终端的内存队列
3. 标记为未投递
4. 当目标会话空闲时，把待投递消息注入目标 PTY

投递的消息会以如下形式写入终端输入：

```text
[Channel message from <from-terminal-id>]: <content>
```

如果目标终端没有运行，消息会留在内存中等待该会话出现并进入空闲。如果 API 先重启了，消息就会丢失。

## CLI 用法

发送消息：

```bash
octogent channel send <terminal-id> "Need review on the parser change"
```

当一个终端给另一个终端发消息时，显式传入发送方：

```bash
octogent channel send <target-terminal-id> "DONE: parser change is ready" --from <sender-terminal-id>
```

省略 `--from` 时，CLI 会在 `OCTOGENT_SESSION_ID` 可用时使用它。

列出消息：

```bash
octogent channel list <terminal-id>
```

## API 用法

- `POST /api/channels/:terminalId/messages`
- `GET /api/channels/:terminalId/messages`

## 当前行为

- 消息存储在内存中
- 消息不会跨 API 重启持久化

`octogent channel send` 会回显两种结果之一：“已投递”表示消息已即时注入；“已排队”表示代理正忙，会在它当前一轮结束后投递。
- 投递状态由 API 跟踪
- 空闲与 stop 钩子事件可以触发投递
- 列出消息会显示当前 API 进程内已排队与已投递的消息

## 实用法则

需要留存的信息，写进触手文件；通道只用于短生命周期的协调。

> 本文件是 [../../guides/inter-agent-messaging.md](../../guides/inter-agent-messaging.md) 的中文翻译版本。如有歧义，以英文原文为准。
