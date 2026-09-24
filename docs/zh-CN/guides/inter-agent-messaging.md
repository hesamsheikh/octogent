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
3. 标记为待投递
4. 当目标会话空闲时，把待投递消息注入目标 PTY

投递的消息会以如下形式写入终端输入：

```text
[Channel message from <from-terminal-id>]: <content>
```

如果目标终端没有运行，消息会留在内存中等待该会话出现并进入空闲。如果 API 先重启了，消息就会丢失。

`octogent channel send` 会回显两种结果之一：“已投递”表示消息已即时注入；“已排队”表示代理正忙，会在它当前一轮结束后投递。随后它会提示用 `octogent channel list <terminal-id>` 查看代理是否已确认收到。

### 已投递不等于已收到

写进终端并不能证明代理拿到了消息：代理 TUI 里弹出的对话框（比如用量上限提示）可能吞掉粘贴内容和提交用的回车。所以 Octogent 以代理自己的回执为准：

1. 一次投递的批次（一起注入的所有消息）在目标下一次 `UserPromptSubmit` 钩子到达之前都是**未确认**；该钩子会把整批消息标记为**已确认**。
2. 如果该会话已经证明钩子可用（收到过它发来的任意 Octogent 钩子），而 10 秒内没有确认，Octogent 会把同一批消息再粘贴一次并再按一次回车。重试和首次投递一样，要等代理空闲。
3. 第二次投递后 10 秒仍未确认，这些消息会被标记为**失败：not acknowledged**，服务日志会记录下来；处于 `running` 的终端还会带上原因 `channel message not acknowledged`，直到代理重新接受提示词为止。

两条规则保证回执可信：

- 从未发来任何钩子的会话不会重试。没有钩子就永远不会有确认，重试只会让代理收到两遍同样的消息；这类消息保持“已投递（未确认）”。
- 一次提交只确认一次注入。终端的初始提示词尚未确认时，下一次提交归它，不归 channel 批次。某个批次等待回执期间，发往该终端的后续消息保持待投递，因为一次提交分不清确认的是两个批次中的哪一个。

`octogent channel list <terminal-id>` 显示每条消息的状态：

| 状态 | 含义 |
| --- | --- |
| `pending` | 已排队，尚未写入终端 |
| `delivered (awaiting receipt)` | 已写入终端，代理尚未确认（没有钩子时也无从确认） |
| `confirmed` | 投递后代理的下一次提示词提交已到达 |
| `failed: not acknowledged` | 写入了两次，两次都没有确认 |

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

每条消息带有 `delivered`（已写入终端），写入后还有 `deliveredAt` 和 `deliveryAttempts`。已确认的消息另有 `acknowledgedAt`；失败的消息另有 `failed`，值为原因。时间均为 ISO 字符串。

## 当前行为

- 消息存储在内存中
- 消息不会跨 API 重启持久化
- 投递状态由 API 跟踪
- 空闲与 stop 钩子事件可以触发投递
- 确认来自目标代理的提示词提交钩子，而不是写入动作本身
- 列出消息会显示当前 API 进程内已排队与已投递的消息

## 实用法则

需要留存的信息，写进触手文件；通道只用于短生命周期的协调。

> 本文件是 [../../guides/inter-agent-messaging.md](../../guides/inter-agent-messaging.md) 的中文翻译版本。如有歧义，以英文原文为准。
