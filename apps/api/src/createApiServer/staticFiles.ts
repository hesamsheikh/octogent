import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export const serveStaticFile = async (
  response: ServerResponse,
  webDistDir: string,
  pathname: string,
): Promise<boolean> => {
  // Prevent path traversal.
  const safePath = pathname.replace(/\.\./g, "").replace(/\/+/g, "/");
  const filePath = join(webDistDir, safePath === "/" ? "index.html" : safePath);

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") {
      console.error(
        `[API] Static file error: ${filePath}`,
        error instanceof Error ? error.message : error,
      );
    }
    return false;
  }
};

/** The SPA: the file when one exists at the path, else index.html for client-side routing. */
export const serveWebApp = async (
  response: ServerResponse,
  webDistDir: string,
  pathname: string,
): Promise<boolean> =>
  (await serveStaticFile(response, webDistDir, pathname)) ||
  (await serveStaticFile(response, webDistDir, "/"));
