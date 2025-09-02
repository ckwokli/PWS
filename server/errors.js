/**
 * API error handling utilities
 * Provides standardized error classes and response helpers for Next.js API routes
 */

/**
 * Base API error class with status code, error code, message and optional details
 */
export class ApiError extends Error {
  constructor(status = 400, code = 'bad_request', message = 'Bad Request', details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.message = message;
    this.details = details;
  }
}

/**
 * Create a 400 Bad Request error
 */
export function badRequest(message = 'Bad Request', details) {
  return new ApiError(400, 'bad_request', message, details);
}

/**
 * Create a 401 Unauthorized error
 */
export function unauthorized(message = 'Unauthorized') {
  return new ApiError(401, 'unauthorized', message);
}

/**
 * Create a 403 Forbidden error
 */
export function forbidden(message = 'Forbidden') {
  return new ApiError(403, 'forbidden', message);
}

/**
 * Create a 404 Not Found error
 */
export function notFound(message = 'Not Found') {
  return new ApiError(404, 'not_found', message);
}

/**
 * Create a 413 Payload Too Large error
 */
export function tooLarge(message = 'Payload Too Large') {
  return new ApiError(413, 'too_large', message);
}

/**
 * Create a 429 Too Many Requests error
 */
export function tooMany(message = 'Too Many Requests') {
  return new ApiError(429, 'too_many', message);
}

/**
 * Create a 500 Internal Server Error
 */
export function serverError(message = 'Internal Server Error', details) {
  return new ApiError(500, 'server_error', message, details);
}

/**
 * Send a standardized error response
 * @param {object} res - Next.js response object
 * @param {Error} err - Error object (ApiError or standard Error)
 */
export function sendError(res, err) {
  const isApiError = err instanceof ApiError;
  const status = isApiError ? err.status : 500;
  const code = isApiError ? err.code : 'server_error';
  const message = isApiError ? err.message : 'Internal Server Error';
  const details = isApiError ? err.details : undefined;
  
  const payload = { 
    error: { 
      code, 
      message 
    }
  };
  
  if (details) {
    payload.details = details;
  }
  
  res.status(status).setHeader('Content-Type', 'application/json').json(payload);
}

/**
 * Send a successful response with data
 * @param {object} res - Next.js response object
 * @param {any} data - Response data
 */
export function ok(res, data) {
  res.status(200).json(data);
}

/**
 * Assert a condition or throw an error
 * @param {boolean} condition - Condition to check
 * @param {Error} err - Error to throw if condition is false
 */
export function assert(condition, err) {
  if (!condition) {
    throw err;
  }
}
