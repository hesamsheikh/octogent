import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed } from "./routeHelpers";

export const handleHealthRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { readHealthSnapshot },
) => {
  if (requestUrl.pathname !== "/api/health") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(response, 200, readHealthSnapshot(), corsOrigin);
  return true;
};
