/**
 * Functional result type (never-throw style)
 */
export type Result<T, E = RemoteError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export interface RemoteError {
  code:
    | 'VALIDATION_ERROR'
    | 'NOT_CONNECTED'
    | 'CONNECTION_ERROR'
    | 'COMMAND_ERROR'
    | 'UPLOAD_ERROR'
    | 'DOWNLOAD_ERROR'
    | 'EXECUTION_ERROR'
    | 'PARSE_ERROR'
    | 'UNKNOWN_ERROR';
  message: string;
  details?: unknown;
}

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = <E = RemoteError>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Converts a function type to its remote callable version (never-throw)
 */
export type RemoteFunction<T extends (...args: any[]) => any> = T extends (
  ...args: infer Args
) => infer Return
  ? Return extends Promise<infer U>
    ? (...args: Args) => Promise<Result<U>>
    : (...args: Args) => Promise<Result<Return>>
  : never;

/**
 * Converts an object type to its remote proxy version
 */
export type RemoteModule<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? RemoteFunction<T[K]>
    : T[K] extends object
    ? RemoteModule<T[K]>
    : T[K];
};

/**
 * Internal execution envelope (from remote runner)
 */
export interface ExecutionResult<T = any> {
  success: boolean;
  result?: T;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}
