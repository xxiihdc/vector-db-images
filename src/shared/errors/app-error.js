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
