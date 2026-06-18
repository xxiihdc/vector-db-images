import { AppError } from "../../shared/errors/app-error.js";

function normalizeBaseUrl(serviceUrl) {
  return String(serviceUrl ?? "").replace(/\/+$/, "");
}

function isSuccessStatus(statusCode) {
  return statusCode >= 200 && statusCode < 300;
}

function buildHttpError({ method, url, status, payload }) {
  return new AppError(`Qdrant request failed: ${method} ${url} returned ${status}.`, {
    code: "VECTOR_BACKEND_HTTP_ERROR",
    details: {
      method,
      url,
      status,
      payload,
    },
  });
}

export function createQdrantClient({
  serviceUrl,
  timeoutMs = 10000,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!serviceUrl) {
    throw new AppError("Qdrant client requires `serviceUrl`.", {
      code: "VECTOR_SERVICE_URL_REQUIRED",
    });
  }

  if (typeof fetchFn !== "function") {
    throw new AppError("Qdrant client requires a fetch implementation.", {
      code: "VECTOR_FETCH_UNAVAILABLE",
    });
  }

  const baseUrl = normalizeBaseUrl(serviceUrl);

  async function request(method, pathname, { body, allow404 = false } = {}) {
    const url = `${baseUrl}${pathname}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (allow404 && response.status === 404) {
        return null;
      }

      if (!isSuccessStatus(response.status)) {
        throw buildHttpError({
          method,
          url,
          status: response.status,
          payload,
        });
      }

      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error?.name === "AbortError") {
        throw new AppError(`Qdrant request timed out after ${timeoutMs}ms.`, {
          code: "VECTOR_BACKEND_TIMEOUT",
          details: {
            method,
            url,
            timeout_ms: timeoutMs,
          },
          cause: error,
        });
      }

      throw new AppError(`Failed to reach Qdrant at ${baseUrl}.`, {
        code: "VECTOR_BACKEND_UNREACHABLE",
        details: {
          method,
          url,
          service_url: baseUrl,
        },
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async listCollections() {
      return request("GET", "/collections");
    },
    async getCollection(collectionName) {
      return request("GET", `/collections/${encodeURIComponent(collectionName)}`, {
        allow404: true,
      });
    },
    async createCollection(collectionName, payload) {
      return request("PUT", `/collections/${encodeURIComponent(collectionName)}`, {
        body: payload,
      });
    },
    async upsertPoints(collectionName, points) {
      return request("PUT", `/collections/${encodeURIComponent(collectionName)}/points`, {
        body: { points },
      });
    },
    async scrollPoints(collectionName, payload) {
      return request("POST", `/collections/${encodeURIComponent(collectionName)}/points/scroll`, {
        body: payload,
      });
    },
    async countPoints(collectionName, payload) {
      return request("POST", `/collections/${encodeURIComponent(collectionName)}/points/count`, {
        body: payload,
      });
    },
    async queryPoints(collectionName, payload) {
      return request("POST", `/collections/${encodeURIComponent(collectionName)}/points/query`, {
        body: payload,
      });
    },
  };
}
