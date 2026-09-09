# 快速入门

这是项目中最短的有用路径。

## 1. 启动应用

对于本地开发：

```bash
pnpm install
pnpm dev
```

对于从克隆仓库进行本地全局 CLI 安装：

```bash
pnpm install
pnpm build
npm install -g .
octogent
```

Octogent 尚未发布到 npm，因此 `npm install -g octogent` 目前不是有效的快速入门路径。

在新的工作空间上，Octogent 会首先打开 Deck 设置流程。设置卡会在你创建触手之前验证工作空间文件、`.gitignore` 和本地先决条件。

## 2. 创建或检查触手

如果应用已在运行，你可以通过 CLI 创建触手：

```bash
octogent tentacle create api-backend --description "API 运行时和请求处理"
```

或者使用 UI 中的 Deck 视图。

每个触手都会成为 `.octogent/tentacles/<tentacle-id>/` 下的一个文件夹。

## 3. 让代理构建本地上下文

触手文件是任务保持本地上下文的地方：

- `CONTEXT.md` 用于该领域的本地模型
- `todo.md` 用于具体任务
- 额外的 markdown 文件用于备注、架构、交接或示例

你不需要将这些视为始终由开发人员手工编写的步骤。Octogent 的要点之一是，**Claude Code** 可以在工作中从应用内部帮助创建、更新和维护这些文件。

## 4. 创建终端

```bash
octogent terminal create --name "API 工作代理" --tentacle-id api-backend
```

如果你想要独立的 git 工作树，请使用 `--workspace-mode worktree`。

## 5. 从待办项委派

运行时可以解析 `todo.md` 中的未完成项，并将其用作从 Deck 集群流程生成子代理时的输入。这意味着一个项可以成为一个工作代理，或者一个较大的列表可以成为一个集群。

## 6. 发送消息

```bash
octogent channel send terminal-2 "请审查请求解析器的更改"
```

## 验证内容

- 触手文件夹存在
- 终端出现在 UI 中
- 该触手存在 `CONTEXT.md` 和 `todo.md`
- 待办进度可见
- 消息出现在目标终端通道中

## 进一步阅读

- [心智模型](../concepts/mental-model.md)
- [触手](../concepts/tentacles.md)

> 本文件是 [../../getting-started/quickstart.md](../../getting-started/quickstart.md) 的中文翻译版本。如有歧义，以英文原文为准。
