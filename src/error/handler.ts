import { AppError, ErrorHandlerResult, ErrorCodeRangeConfig } from './types';

/**
 * Sensitive keywords that should be filtered from error messages
 * Using word boundary patterns to avoid false positives (e.g., "selective" matching "select")
 */
const SENSITIVE_KEYWORD_PATTERNS: RegExp[] = [
  // Database related - exact word matches
  /\bsql\b/i,
  /\bdatabase\b/i,
  /\bquery\b/i,
  /\bmysql\b/i,
  /\bpostgres\b/i,
  /\bmongodb\b/i,
  /\bredis\b/i,
  /\bgorm\b/i,
  // SQL keywords - require word boundaries
  /\bselect\s+\*/i, // "select *" (actual SQL)
  /\binsert\s+into\b/i, // "insert into" (actual SQL)
  /\bupdate\s+\w+\s+set\b/i, // "update table set" (actual SQL)
  /\bdelete\s+from\b/i, // "delete from" (actual SQL)
  /\bdrop\s+(table|database)\b/i, // "drop table/database"
  // Stack trace related
  /\bstacktrace\b/i,
  /\btraceback\b/i,
  /\bbacktrace\b/i,
  /\berror:\s/i, // "error: " with colon and space
  /\bat line\b/i,
  /\bin file\b/i,
  // Sensitive info - exact word matches
  /\bpassword\b/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /\bcredential\b/i,
  // Framework/server info
  /\bexpress\b/i,
  /\bdjango\b/i,
  /\bflask\b/i,
  /\bnginx\b/i,
  /\bapache\b/i,
  /\baxios\b/i,
  // Internal error indicators
  /\bpanic\b/i,
  /\bfatal\b/i,
  /\bassertion\b/i,
  /\bnull pointer\b/i,
  /\bnil pointer\b/i,
  /\bsegmentation fault\b/i,
  // IP/ports - specific patterns
  /\blocalhost\b/i,
  /127\.0\.0\.1/,
  /0\.0\.0\.0/,
  /:\d{4,5}\b/, // Port numbers like :3000, :8080
];

/**
 * Literal sensitive substrings (no word boundary needed)
 */
const SENSITIVE_SUBSTRINGS = [
  // System paths - these are clearly internal
  '/var/',
  '/usr/',
  '/home/',
  '/opt/',
  'c:\\',
  'd:\\',
  'node_modules',
  '/src/',
  '/internal/',
];

/**
 * Path patterns that indicate internal information
 */
const PATH_PATTERNS = [
  /[a-z]:\\[\w\\]+/i, // Windows path (C:\path\to\file)
  /\/[\w\/]+\.(js|ts|tsx|jsx|go|py)/i, // Unix file path
  /line\s+\d+/i, // "line 123"
  /at\s+[\w.]+\s+\(/i, // Stack frame "at funcName ("
];

/**
 * Check if a string contains sensitive information
 */
export function containsSensitiveInfo(text: string): boolean {
  if (!text) return false;

  const lower = text.toLowerCase();

  // Check for literal substrings (paths, etc.)
  if (SENSITIVE_SUBSTRINGS.some(sub => lower.includes(sub.toLowerCase()))) {
    return true;
  }

  // Check for sensitive keyword patterns (with word boundaries)
  if (SENSITIVE_KEYWORD_PATTERNS.some(pattern => pattern.test(text))) {
    return true;
  }

  // Check for path patterns
  if (PATH_PATTERNS.some(pattern => pattern.test(text))) {
    return true;
  }

  return false;
}

/**
 * Filter sensitive information from error detail
 * In production mode, removes any potentially sensitive content
 */
export function filterSensitiveData(
  detail: string | undefined,
  isDev = false
): string | undefined {
  if (!detail || typeof detail !== 'string') {
    return undefined;
  }

  // In development, allow more detail
  if (isDev) {
    return detail;
  }

  // In production, be strict
  if (containsSensitiveInfo(detail) || detail.length > 200) {
    return undefined;
  }

  return detail;
}

/**
 * Type guard to check if error has AppError properties
 */
function hasAppErrorProps(
  error: Error
): error is Error & { code?: string | number; detail?: string } {
  return 'code' in error || 'detail' in error;
}

/**
 * Type guard to check if object has error-like properties
 */
function isErrorLikeObject(
  obj: object
): obj is { message?: unknown; error?: unknown; code?: unknown; detail?: unknown } {
  return 'message' in obj || 'error' in obj || 'code' in obj;
}

/**
 * Normalize any error to AppError format
 * Note: Error properties are non-enumerable, so we explicitly copy them
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof Error) {
    const result: AppError = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: 'UNKNOWN_ERROR',
      originalError: error,
    };

    if (hasAppErrorProps(error)) {
      result.code = error.code ?? 'UNKNOWN_ERROR';
      result.detail = error.detail;
    }

    return result;
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
      code: 'UNKNOWN_ERROR',
    } as AppError;
  }

  if (typeof error === 'object' && error !== null) {
    if (isErrorLikeObject(error)) {
      const message =
        typeof error.message === 'string'
          ? error.message
          : typeof error.error === 'string'
            ? error.error
            : 'Unknown error';

      const code =
        typeof error.code === 'string' || typeof error.code === 'number'
          ? error.code
          : 'UNKNOWN_ERROR';

      return {
        name: 'Error',
        message,
        code,
        detail: typeof error.detail === 'string' ? error.detail : undefined,
      } as AppError;
    }

    return {
      name: 'Error',
      message: 'Unknown error',
      code: 'UNKNOWN_ERROR',
    } as AppError;
  }

  return {
    name: 'Error',
    message: 'Unknown error',
    code: 'UNKNOWN_ERROR',
  } as AppError;
}

/**
 * Default error code ranges for typical API error codes
 */
export const DEFAULT_ERROR_RANGES: ErrorCodeRangeConfig[] = [
  { start: 100000, end: 200000, defaultMessage: 'System error, please try again later', isRetryable: true },
  { start: 200000, end: 300000, defaultMessage: 'Authentication required', isRetryable: false },
  { start: 300000, end: 400000, defaultMessage: 'Operation failed, please retry', isRetryable: true },
  { start: 400000, end: 500000, defaultMessage: 'Data processing failed', isRetryable: false },
  { start: 500000, end: 600000, defaultMessage: 'Service temporarily unavailable', isRetryable: true },
];

/**
 * Get a user-friendly message based on error code
 */
export function getUserFriendlyMessage(
  errorCode: number,
  messages: Record<number, string> = {},
  ranges: ErrorCodeRangeConfig[] = DEFAULT_ERROR_RANGES,
  fallback = 'Operation failed, please retry'
): string {
  // Check predefined messages first
  if (messages[errorCode]) {
    return messages[errorCode];
  }

  // Check error ranges
  for (const range of ranges) {
    if (errorCode >= range.start && errorCode < range.end) {
      return range.defaultMessage;
    }
  }

  return fallback;
}

/**
 * Check if an error is retryable based on its code
 */
export function isRetryableError(
  errorCode: number,
  ranges: ErrorCodeRangeConfig[] = DEFAULT_ERROR_RANGES
): boolean {
  for (const range of ranges) {
    if (errorCode >= range.start && errorCode < range.end) {
      return range.isRetryable;
    }
  }
  return false;
}

/**
 * Create a standardized error object
 */
export function createError(
  code: string | number,
  message: string,
  detail?: string
): AppError {
  const error = new Error(message) as AppError;
  error.code = code;
  error.detail = detail;
  return error;
}

/**
 * Error handler class for unified error processing
 */
export class ErrorHandler {
  private messages: Record<number, string>;
  private ranges: ErrorCodeRangeConfig[];
  private isDev: boolean;

  constructor(options: {
    messages?: Record<number, string>;
    ranges?: ErrorCodeRangeConfig[];
    isDev?: boolean;
  } = {}) {
    this.messages = options.messages ?? {};
    this.ranges = options.ranges ?? DEFAULT_ERROR_RANGES;
    this.isDev = options.isDev ?? false;
  }

  /**
   * Handle an API error and return a standardized result
   */
  handleError(error: unknown): ErrorHandlerResult {
    const normalized = normalizeError(error);
    const errorCode = typeof normalized.code === 'number' ? normalized.code : 0;

    // Safely extract request_id from error object
    let requestId: string | undefined;
    if (typeof error === 'object' && error !== null && 'request_id' in error) {
      const rid = (error as { request_id: unknown }).request_id;
      requestId = typeof rid === 'string' ? rid : undefined;
    }

    return {
      message: normalized.message,
      userMessage: getUserFriendlyMessage(errorCode, this.messages, this.ranges),
      code: normalized.code,
      detail: filterSensitiveData(normalized.detail, this.isDev),
      requestId,
      isRetryable: isRetryableError(errorCode, this.ranges),
    };
  }

  /**
   * Create a standardized error
   */
  createError(code: string | number, message: string, detail?: string): AppError {
    return createError(code, message, detail);
  }
}

/**
 * Create an error handler instance
 */
export function createErrorHandler(options?: {
  messages?: Record<number, string>;
  ranges?: ErrorCodeRangeConfig[];
  isDev?: boolean;
}): ErrorHandler {
  return new ErrorHandler(options);
}
