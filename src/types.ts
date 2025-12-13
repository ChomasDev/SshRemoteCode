/**
 * Type utilities for remote function calls
 */

/**
 * Converts a function type to its remote callable version
 * All parameters and return values are serialized/deserialized
 */
export type RemoteFunction<T extends (...args: any[]) => any> = T extends (
  ...args: infer Args
) => infer Return
  ? Return extends Promise<infer U>
    ? (...args: Args) => Promise<U>
    : (...args: Args) => Promise<Return>
  : never;

/**
 * Converts an object type to its remote proxy version
 * All methods become async and return promises
 */
export type RemoteModule<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? RemoteFunction<T[K]>
    : T[K] extends object
    ? RemoteModule<T[K]>
    : T[K];
};

/**
 * Result of remote code execution
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

/**
 * Remote function call payload
 */
export interface RemoteCallPayload {
  modulePath: string;
  functionName: string;
  args: any[];
}

