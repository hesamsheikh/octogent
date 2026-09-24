export type PageMode = { kind: "root" } | { kind: "project"; projectKey: string };

// Mirrors the hub's web mount (`/p/<key>` with an optional rest), so the page
// and the server always agree on which project a path names.
const PROJECT_PAGE_PATH = /^\/p\/([^/]+)(?:\/|$)/;

/**
 * Which page the SPA is: a project page under a hub, or the root, where it
 * has to ask the server whether it is a hub at all. `projectKey` stays as the
 * address bar encodes it so it can be spliced back into URLs untouched.
 */
export const resolvePageMode = (pathname: string): PageMode => {
  const match = PROJECT_PAGE_PATH.exec(pathname);
  return match?.[1] ? { kind: "project", projectKey: match[1] } : { kind: "root" };
};

export const decodeProjectKey = (projectKey: string): string => {
  try {
    return decodeURIComponent(projectKey);
  } catch {
    return projectKey;
  }
};
