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
3. marks it as undelivered
4. injects pending messages into the target PTY when the target session is idle

Delivered messages are written into the terminal input as lines like:

```text
[Channel message from <from-terminal-id>]: <content>
```

If the target terminal is not running, the message waits in memory until that session exists and becomes idle. If the API restarts first, the message is lost.

`octogent channel send` reports which of the two happened: "delivered" when the message was injected immediately, "queued" when the agent was busy and it will be delivered at the end of the current turn.

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

## Current behavior

- messages are stored in memory
- messages do not persist across API restarts
- delivery state is tracked by the API
- idle and stop hook events can trigger delivery
- listing messages shows queued and delivered messages for the current API process

## Practical rule

If a message needs to survive, write it into the tentacle files. Use the channel for short-lived coordination only.
