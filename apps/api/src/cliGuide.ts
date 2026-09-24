import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Locale } from "@octogent/core";

import { describeEffortTierDefaults } from "./terminalRuntime/modelSelection";

/**
 * `octogent guide` and `octogent setup-agents`.
 *
 * Coordinators (a Claude Code or Codex session driving Octogent from a shell)
 * learned the CLI by reading --help and this repository's docs, and three of
 * them made the same mistakes (no --tentacle-id, polling `terminal list`,
 * hand-rolled WebSocket listeners). The user-level skill installed here gives
 * every session the routine; `guide` prints the exact, current command surface
 * so the skill itself never goes stale.
 */

const GUIDE_EN = (tiers: string) => `Octogent — how a coordinator gets work done (installed version)

Run everything from the project directory. No browser or API calls needed.

1. Dispatch
   octogent tentacle create <id> --description "..."          # one per work stream
   octogent terminal create --terminal-id <name> --name "..." \\
     --tentacle-id <id> --workspace-mode worktree|shared \\
     --agent-provider claude-code|codex [--effort light|standard|heavy|max | --model <id>] \\
     --initial-prompt "<full task: goal, files, behavior, tests, gates, 'commit on your branch, do not push', 'end with a summary and doubts'>"
   Always pass --tentacle-id; without it the terminal reports directly to the octoboss.
   Workers start from a clean environment: put a project's venv/PATH in <workspace>/.octogent/env,
   or pass --inherit-env PATH,VIRTUAL_ENV to copy named variables from your shell for one worker.
   Effort tiers today (Codex falls back per account to the first slug its models cache lists):
${tiers}

2. Wait
   octogent terminal wait <id> [<id>...] [--timeout <s>] [--attention-after <s>] [--json]
   exit 0 = all awaiting-review/completed; 1 = other ending; 2 = timeout; 3 = needs attention
   (a dialog is blocking the worker, or its provider refused — the block says which).

3. Read the answer
   octogent terminal result <id> [--json] [--screen]

4. See and unstick a worker
   octogent terminal screen <id> [--lines N]                  # the terminal as a person sees it
   octogent terminal input <id> [text] [--enter] [--keys enter,esc,up,down,tab,ctrl-c,1-9]
   octogent terminal list                                     # waiting=… and error=… markers

5. Follow up
   octogent channel send <id> "..."                           # delivered when the agent is idle
   octogent channel list <id>                                 # pending | delivered (awaiting receipt) | confirmed | failed

6. Review and merge (worktree workers)
   git diff main..octogent/<id>   →   git merge --no-ff octogent/<id>

7. Finish — you end every worker
   octogent terminal delete <id> --with-worktree              # after merging (live merge check)
   octogent terminal stop <id>                                # otherwise

Hub: commands run in a project directory reach that project; elsewhere add --project <slug|id>.
   octogent hub status   octogent projects   (dashboard: <hub>/p/<slug>/, overview at <hub>/)
Other: octogent logs [--lines N] [--follow]   octogent worktree gc [--dry-run]   octogent terminal archive|prune
Full reference: docs/reference/cli.md in the Octogent repository; docs/guides/getting-work-done.md for the guide.
`;

const GUIDE_ZH = (tiers: string) => `Octogent — 协调者工作法（当前安装版本）

所有命令在项目目录里运行，不需要浏览器，也不需要直接调 API。

1. 派发
   octogent tentacle create <触手ID> --description "..."       # 每条工作线一个
   octogent terminal create --terminal-id <名字> --name "..." \\
     --tentacle-id <触手ID> --workspace-mode worktree|shared \\
     --agent-provider claude-code|codex [--effort light|standard|heavy|max | --model <型号>] \\
     --initial-prompt "<完整任务：目标、文件范围、要求的行为、测试、门禁、'在自己分支提交不要 push'、'最后给总结和疑问'>"
   一定要带 --tentacle-id，不带就直属 octoboss。
   工人从干净环境启动：项目的 venv/PATH 写在 <工作区>/.octogent/env，
   或用 --inherit-env PATH,VIRTUAL_ENV 把你 shell 里指定的变量复制给这一个工人。
   当前档位（Codex 按账号回退：取其模型缓存里列出的第一个候选）：
${tiers}

2. 等待
   octogent terminal wait <ID> [<ID>...] [--timeout 秒] [--attention-after 秒] [--json]
   退出码 0 = 全部待审阅/已完成；1 = 其他方式结束；2 = 超时；3 = 需要处理
   （工人被对话框挡住，或供应商拒绝了——结果块里写明是哪种）。

3. 读回答
   octogent terminal result <ID> [--json] [--screen]

4. 看屏幕、解卡
   octogent terminal screen <ID> [--lines N]                  # 人眼看到的终端画面
   octogent terminal input <ID> [文字] [--enter] [--keys enter,esc,up,down,tab,ctrl-c,1-9]
   octogent terminal list                                     # 行尾的 waiting=… 与 error=…

5. 追问
   octogent channel send <ID> "..."                           # 代理空闲时投递
   octogent channel list <ID>                                 # pending | delivered (awaiting receipt) | confirmed | failed

6. 审阅与合并（工作树工人）
   git diff main..octogent/<ID>   →   git merge --no-ff octogent/<ID>

7. 收尾——每个工人都由你结束
   octogent terminal delete <ID> --with-worktree              # 合并后（现场核对已合并）
   octogent terminal stop <ID>                                # 其他情况

Hub：在项目目录里运行的命令自动连到该项目；在别处加 --project <slug|id>。
   octogent hub status   octogent projects   （面板：<hub>/p/<slug>/，总览：<hub>/）
其他：octogent logs [--lines N] [--follow]   octogent worktree gc [--dry-run]   octogent terminal archive|prune
完整参考：仓库里的 docs/zh-CN/reference/cli.md；入门看 docs/zh-CN/guides/getting-work-done.md。
`;

// The tier line is generated from the same table terminal create uses, so the
// guide can never describe a mapping the server no longer applies.
export const renderGuide = (locale: Locale): string => {
  const tiers = describeEffortTierDefaults()
    .map((line) => `     ${line}`)
    .join("\n");
  return locale === "zh-CN" ? GUIDE_ZH(tiers) : GUIDE_EN(tiers);
};

export type AgentSkillTarget = { name: "claude-code" | "codex"; directory: string };

/** Where each CLI loads user-level skills from. Both read `<dir>/<skill>/SKILL.md`. */
export const resolveAgentSkillTargets = (
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): AgentSkillTarget[] => {
  const claudeHome = env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const codexHome = env.CODEX_HOME?.trim() || join(home, ".codex");
  return [
    { name: "claude-code", directory: join(claudeHome, "skills", "octogent") },
    { name: "codex", directory: join(codexHome, "skills", "octogent") },
  ];
};

const MARKER =
  "\n<!-- installed by `octogent setup-agents`; remove with `octogent setup-agents --remove` -->\n";

export type SetupAgentsResult = {
  target: AgentSkillTarget;
  action: "installed" | "updated" | "removed" | "absent";
};

/**
 * Installs (or removes) the Octogent skill for every agent CLI. Only this one
 * directory is touched: ~/.codex is the operator's real desktop configuration
 * and ~/.claude holds their sessions, so nothing else is read or written.
 */
export const setupAgentSkills = (
  sourceDir: string,
  targets: AgentSkillTarget[],
  options: { remove?: boolean } = {},
): SetupAgentsResult[] => {
  const results: SetupAgentsResult[] = [];
  for (const target of targets) {
    if (options.remove) {
      const existed = existsSync(target.directory);
      rmSync(target.directory, { recursive: true, force: true });
      results.push({ target, action: existed ? "removed" : "absent" });
      continue;
    }
    const existed = existsSync(join(target.directory, "SKILL.md"));
    mkdirSync(target.directory, { recursive: true });
    cpSync(sourceDir, target.directory, { recursive: true });
    const skillPath = join(target.directory, "SKILL.md");
    const body = readFileSync(skillPath, "utf8");
    if (!body.includes(MARKER.trim())) {
      writeFileSync(skillPath, `${body.trimEnd()}\n${MARKER}`, "utf8");
    }
    results.push({ target, action: existed ? "updated" : "installed" });
  }
  return results;
};
