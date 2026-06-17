export class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.details = options.details ?? null;
    this.cause = options.cause;
  }
}

export function toErrorPayload(error) {
  if (error instanceof AppError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  return {
    name: error?.name ?? "Error",
    code: "UNHANDLED_ERROR",
    message: error?.message ?? "Unknown error",
    details: null,
  };
}

function serializeCause(cause) {
  if (!cause) {
    return null;
  }

  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack ?? null,
      cause: serializeCause(cause.cause),
    };
  }

  return {
    value: String(cause),
  };
}

export function toDiagnosticErrorPayload(error) {
  if (error instanceof AppError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
      stack: error.stack ?? null,
      cause: serializeCause(error.cause),
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      code: "UNHANDLED_ERROR",
      message: error.message,
      details: null,
      stack: error.stack ?? null,
      cause: serializeCause(error.cause),
    };
  }

  return {
    name: "UnknownError",
    code: "UNHANDLED_ERROR",
    message: "Unknown error",
    details: null,
    stack: null,
    cause: serializeCause(error),
  };
}
