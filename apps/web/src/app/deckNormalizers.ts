import type { DeckTentacleSummary } from "@octogent/core";

// Shared by every surface that reads /api/deck/tentacles (canvas, flow view),
// so the wire-format tolerance lives in exactly one place.
export const normalizeDeckTentacleSummary = (value: unknown): DeckTentacleSummary | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.tentacleId !== "string") {
    return null;
  }

  const todoItems = Array.isArray(record.todoItems)
    ? record.todoItems
        .map((item) => {
          if (item === null || typeof item !== "object") {
            return null;
          }

          const todoRecord = item as Record<string, unknown>;
          if (typeof todoRecord.text !== "string") {
            return null;
          }

          return {
            text: todoRecord.text,
            done: todoRecord.done === true,
          };
        })
        .filter((item): item is { text: string; done: boolean } => item !== null)
    : [];

  const scopeRecord =
    record.scope !== null && typeof record.scope === "object"
      ? (record.scope as Record<string, unknown>)
      : null;
  const octopusRecord =
    record.octopus !== null && typeof record.octopus === "object"
      ? (record.octopus as Record<string, unknown>)
      : null;

  const status =
    record.status === "idle" ||
    record.status === "active" ||
    record.status === "blocked" ||
    record.status === "needs-review"
      ? record.status
      : "idle";

  return {
    tentacleId: record.tentacleId,
    displayName: typeof record.displayName === "string" ? record.displayName : record.tentacleId,
    description: typeof record.description === "string" ? record.description : "",
    status,
    color: typeof record.color === "string" ? record.color : null,
    octopus: {
      animation: typeof octopusRecord?.animation === "string" ? octopusRecord.animation : null,
      expression: typeof octopusRecord?.expression === "string" ? octopusRecord.expression : null,
      accessory: typeof octopusRecord?.accessory === "string" ? octopusRecord.accessory : null,
      hairColor: typeof octopusRecord?.hairColor === "string" ? octopusRecord.hairColor : null,
    },
    scope: {
      paths: Array.isArray(scopeRecord?.paths)
        ? scopeRecord.paths.filter((path): path is string => typeof path === "string")
        : [],
      tags: Array.isArray(scopeRecord?.tags)
        ? scopeRecord.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
    },
    vaultFiles: Array.isArray(record.vaultFiles)
      ? record.vaultFiles.filter((file): file is string => typeof file === "string")
      : [],
    todoTotal:
      typeof record.todoTotal === "number" && Number.isFinite(record.todoTotal)
        ? record.todoTotal
        : todoItems.length,
    todoDone:
      typeof record.todoDone === "number" && Number.isFinite(record.todoDone)
        ? record.todoDone
        : todoItems.filter((item) => item.done).length,
    todoItems,
    suggestedSkills: Array.isArray(record.suggestedSkills)
      ? record.suggestedSkills.filter((skill): skill is string => typeof skill === "string")
      : [],
  };
};
