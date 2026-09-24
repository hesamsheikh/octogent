import { statSync } from "node:fs";
import { join } from "node:path";

import { type Locale, t } from "@octogent/core";

import { resolveRootVersion } from "./healthSnapshot";

/** What a hub records in hub.json and a CLI compares against. */
export type BuildIdentity = { version: string; commit?: string; builtAt?: string };

export type BuildDrift = "older" | "different";

/**
 * The version alone misses rebuilds of the same version, which is how this
 * project is mostly run; the commit (when the build names one) or the
 * bundle's mtime tells them apart.
 */
export const resolveBuildIdentity = (
  packageRoot: string,
  env: Record<string, string | undefined> = process.env,
): BuildIdentity => {
  const commit = env.OCTOGENT_BUILD_COMMIT?.trim();
  let builtAt: string | undefined;
  try {
    builtAt = statSync(join(packageRoot, "dist", "api", "cli.js")).mtime.toISOString();
  } catch {
    // Running from source: there is no bundle to date.
  }
  return {
    version: resolveRootVersion(packageRoot),
    ...(commit ? { commit } : {}),
    ...(builtAt ? { builtAt } : {}),
  };
};

const compareVersions = (a: string, b: string): number => {
  const partsA = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  const partsB = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const left = partsA[index] ?? 0;
    const right = partsB[index] ?? 0;
    if (Number.isNaN(left) || Number.isNaN(right)) {
      return Number.NaN;
    }
    if (left !== right) {
      return left - right;
    }
  }
  return 0;
};

/** Null when the hub runs the CLI's build, or when nothing comparable says otherwise. */
export const describeBuildDrift = (hub: BuildIdentity, cli: BuildIdentity): BuildDrift | null => {
  if (hub.version !== cli.version) {
    return compareVersions(hub.version, cli.version) < 0 ? "older" : "different";
  }
  if (hub.commit && cli.commit) {
    return hub.commit === cli.commit ? null : "different";
  }
  if (hub.builtAt && cli.builtAt && hub.builtAt !== cli.builtAt) {
    return hub.builtAt < cli.builtAt ? "older" : "different";
  }
  return null;
};

export const formatBuildLabel = (build: BuildIdentity): string => {
  const detail = build.commit ?? build.builtAt;
  return detail ? `${build.version} (${detail})` : build.version;
};

/** Warns about the first drifting hub it is shown, and stays quiet after. */
export const createDriftWarner = (
  cli: BuildIdentity,
  locale: Locale,
  write: (line: string) => void,
) => {
  let warned = false;
  return (hub: BuildIdentity) => {
    if (warned) {
      return;
    }
    const drift = describeBuildDrift(hub, cli);
    if (!drift) {
      return;
    }
    warned = true;
    write(
      t(locale, drift === "older" ? "cli.hub.driftOlder" : "cli.hub.driftDifferent", {
        hub: formatBuildLabel(hub),
        cli: formatBuildLabel(cli),
      }),
    );
  };
};
