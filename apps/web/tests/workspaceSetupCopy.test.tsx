import type { WorkspaceSetupStep } from "@octogent/core";
import { en, t, zhCN } from "@octogent/core";
import { describe, expect, it } from "vitest";

import { resolveSetupStepCopy } from "../src/app/workspaceSetupCopy";

const step = (overrides: Partial<WorkspaceSetupStep> = {}): WorkspaceSetupStep => ({
  id: "initialize-workspace",
  title: "Initialize workspace",
  description: "Create Octogent project files and runtime directories.",
  complete: false,
  required: true,
  actionLabel: "Initialize workspace",
  statusText: "Create .octogent project files before continuing.",
  guidance: null,
  command: "octogent init",
  ...overrides,
});

describe("resolveSetupStepCopy", () => {
  it("renders the operator's language instead of the API's English copy", () => {
    const copy = resolveSetupStepCopy(step(), (key) => t("zh-CN", key));

    expect(copy.title).toBe("初始化工作区");
    expect(copy.description).toBe("创建 Octogent 项目文件与运行时目录。");
    expect(copy.actionLabel).toBe("初始化工作区");
  });

  it("falls back to the API copy for a step the UI does not know yet", () => {
    const copy = resolveSetupStepCopy(
      step({ id: "future-step" as WorkspaceSetupStep["id"], title: "Future step" }),
      (key) => t("zh-CN", key),
    );

    expect(copy.title).toBe("Future step");
    expect(copy.description).toBe("Create Octogent project files and runtime directories.");
  });

  it("keeps a null action label null", () => {
    const copy = resolveSetupStepCopy(step({ actionLabel: null }), (key) => t("en", key));

    expect(copy.actionLabel).toBeNull();
  });

  it("covers every shipped step id in both catalogues", () => {
    const ids = [
      "initialize-workspace",
      "ensure-gitignore",
      "check-claude",
      "check-git",
      "check-curl",
      "create-tentacles",
    ] as const;

    for (const id of ids) {
      for (const catalogue of [en, zhCN]) {
        expect(catalogue).toHaveProperty(`web.deck.workspaceSetup.step.${id}.title`);
        expect(catalogue).toHaveProperty(`web.deck.workspaceSetup.step.${id}.desc`);
      }
    }
  });
});
