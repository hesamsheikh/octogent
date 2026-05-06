export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = { signal?: AbortSignal };

const JSON_HEADERS = { "Content-Type": "application/json" };

const checkOk = async (response: Response): Promise<void> => {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message);
  }
};

const withSignal = (options?: RequestOptions): { signal?: AbortSignal } =>
  options?.signal !== undefined ? { signal: options.signal } : {};

export const apiClient = {
  async get<T>(url: string, options?: RequestOptions): Promise<T> {
    const response = await fetch(url, { ...withSignal(options) });
    await checkOk(response);
    return response.json() as Promise<T>;
  },

  async getText(url: string, options?: RequestOptions): Promise<string> {
    const response = await fetch(url, { ...withSignal(options) });
    await checkOk(response);
    return response.text();
  },

  async post<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      ...(body !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
      ...withSignal(options),
    });
    await checkOk(response);
    return response.json() as Promise<T>;
  },

  async postEmpty(url: string, body?: unknown, options?: RequestOptions): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      ...(body !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
      ...withSignal(options),
    });
    await checkOk(response);
  },

  async patch<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const response = await fetch(url, {
      method: "PATCH",
      ...(body !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
      ...withSignal(options),
    });
    await checkOk(response);
    return response.json() as Promise<T>;
  },

  async patchEmpty(url: string, body?: unknown, options?: RequestOptions): Promise<void> {
    const response = await fetch(url, {
      method: "PATCH",
      ...(body !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
      ...withSignal(options),
    });
    await checkOk(response);
  },

  async delete(url: string, options?: RequestOptions): Promise<void> {
    const response = await fetch(url, { method: "DELETE", ...withSignal(options) });
    await checkOk(response);
  },

  async put<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const response = await fetch(url, {
      method: "PUT",
      ...(body !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
      ...withSignal(options),
    });
    await checkOk(response);
    return response.json() as Promise<T>;
  },
};
