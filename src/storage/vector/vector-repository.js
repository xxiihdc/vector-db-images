import { AppError } from "../../shared/errors/app-error.js";
import { createJsonVectorRepository } from "./json-vector-repository.js";
import { createQdrantVectorRepository } from "./qdrant-vector-repository.js";

export function createVectorRepository(options = {}) {
  const backend = options.backend ?? (options.filePath ? "json-file" : "qdrant");

  if (backend === "json-file") {
    return createJsonVectorRepository(options);
  }

  if (backend === "qdrant") {
    return createQdrantVectorRepository({
      serviceUrl: options.serviceUrl,
      collectionName: options.collectionName,
      distance: options.distance,
      timeoutMs: options.timeoutMs,
      fetchFn: options.fetchFn,
    });
  }

  throw new AppError(`Unsupported vector backend: ${backend}`, {
    code: "VECTOR_BACKEND_UNSUPPORTED",
    details: { backend },
  });
}
