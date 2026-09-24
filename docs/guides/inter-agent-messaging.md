# Inter-Agent Messaging

Octogent has a simple local channel system for messages between terminals.

## What channels are

Channels are in-memory queues keyed by target terminal ID. Sending a message does not write to the target tentacle files and does not create a persistent notification record.

Use them for short coordination:

- ask for review
- report completion
- hand off a finding
- point another agent to a file or risk

It is not a replacement for proper context files.

## Delivery model

When a message is sent, Octogent:

1. verifies the target terminal record exists
2. appends the message to that terminal's in-memory queue
3. marks it as pending
4. injects pending messages into the target PTY when the target session is idle

Delivered messages are written into the terminal input as lines like:

```text
[Channel message from <from-terminal-id>]: <content>
```

If the target terminal is not running, the message waits in memory until that session exists and becomes idle. If the API restarts first, the message is lost.

`octogent channel send` reports which of the two happened: "delivered" when the message was injected immediately, "queued" when the agent was busy and it will be delivered at the end of the current turn. It then points to `octogent channel list <terminal-id>`, which shows whether the agent confirmed the message.

### Delivered is not received

Writing into the terminal does not prove the agent got the message: a dialog in the agent's TUI (a usage-limit prompt, say) can take the paste and the Enter that submits it. So Octogent waits for the agent's own receipt:

1. A delivered batch (all messages injected together) is **unconfirmed** until the target's next `UserPromptSubmit` hook. That hook marks every message of the batch **confirmed**.
2. If the session has already shown working hooks (any Octogent hook has arrived from it) and no confirmation comes within 10 seconds, Octogent pastes the same batch once more and presses Enter again. The retry waits for the agent to be idle, like the first delivery.
3. If the second attempt is not confirmed within 10 seconds either, the messages are marked **failed: not acknowledged** and the server log records it. A `running` terminal also gets the reason `channel message not acknowledged` until the agent accepts a prompt again.

Two rules keep the receipt honest:

- A session that has never sent a hook is not retried. Without hooks nothing is ever confirmed, and a retry would hand the agent the same message twice. Its messages stay "delivered (awaiting receipt)".
- One submit confirms one injection. While a terminal's initial prompt is still unconfirmed, the next submit belongs to it, not to a channel batch. While a batch waits for its receipt, later messages to that terminal stay pending, because a submit cannot say which of two batches it confirms.

`octogent channel list <terminal-id>` shows each message's state:

| Status | Meaning |
| --- | --- |
| `pending` | queued; not written into the terminal yet |
| `delivered (awaiting receipt)` | written into the terminal; the agent has not confirmed it (or cannot, without hooks) |
| `confirmed` | the agent's next prompt submit arrived after delivery |
| `failed: not acknowledged` | written twice, confirmed neither time |

## CLI usage

Send a message:

```bash
octogent channel send <terminal-id> "Need review on the parser change"
```

When one terminal is messaging another, pass the sender explicitly:

```bash
octogent channel send <target-terminal-id> "DONE: parser change is ready" --from <sender-terminal-id>
```

If `--from` is omitted, the CLI uses `OCTOGENT_SESSION_ID` when it is available.

List messages:

```bash
octogent channel list <terminal-id>
```

## API usage

- `POST /api/channels/:terminalId/messages`
- `GET /api/channels/:terminalId/messages`

Each message carries `delivered` (written into the terminal) and, once that happens, `deliveredAt` and `deliveryAttempts`. A confirmed message adds `acknowledgedAt`; a failed one adds `failed` with the reason. All times are ISO strings.

## Current behavior

- messages are stored in memory
- messages do not persist across API restarts
- delivery state is tracked by the API
- idle and stop hook events can trigger delivery
- confirmation comes from the target agent's prompt-submit hook, not from the write itself
- listing messages shows queued and delivered messages for the current API process

## Practical rule

If a message needs to survive, write it into the tentacle files. Use the channel for short-lived coordination only.
