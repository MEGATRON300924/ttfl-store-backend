export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, code = "BAD_REQUEST", details?: unknown) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(message = "Authentication required", code = "UNAUTHORIZED") {
    return new AppError(401, code, message);
  }
  static forbidden(message = "You don't have access to this resource", code = "FORBIDDEN") {
    return new AppError(403, code, message);
  }
  static notFound(message = "Resource not found", code = "NOT_FOUND") {
    return new AppError(404, code, message);
  }
  static conflict(message: string, code = "CONFLICT") {
    return new AppError(409, code, message);
  }
  static tooMany(message = "Too many requests, please try again later", code = "RATE_LIMITED") {
    return new AppError(429, code, message);
  }
  static internal(message = "Something went wrong", code = "INTERNAL_ERROR") {
    return new AppError(500, code, message);
  }
}
