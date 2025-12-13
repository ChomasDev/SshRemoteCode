import { RemoteExecutor } from './executor';
import { RemoteModule } from './types';

/**
 * Creates a transparent proxy for remote module imports
 */
export class RemoteProxy {
  private cache: Map<string, any> = new Map();

  constructor(private executor: RemoteExecutor, private modulePath: string) {}

  /**
   * Create a proxy object that intercepts method calls
   */
  createProxy<T = any>(): RemoteModule<T> {
    if (this.cache.has(this.modulePath)) {
      return this.cache.get(this.modulePath);
    }

    const proxy = new Proxy(
      {},
      {
        get: (target, prop: string | symbol) => {
          if (typeof prop === 'symbol') {
            return undefined;
          }

          // Handle special properties
          if (prop === 'then' || prop === 'catch' || prop === 'finally') {
            return undefined; // Prevent being treated as a Promise
          }

          // Return a function that executes remotely
          return async (...args: any[]) => {
            try {
              return await this.executor.executeFunction(this.modulePath, prop, args);
            } catch (error) {
              throw error;
            }
          };
        },
        has: () => true,
        ownKeys: () => [],
        getOwnPropertyDescriptor: () => ({
          enumerable: true,
          configurable: true,
        }),
      }
    ) as RemoteModule<T>;

    this.cache.set(this.modulePath, proxy);
    return proxy;
  }

  /**
   * Clear the cache for this module
   */
  clearCache(): void {
    this.cache.delete(this.modulePath);
  }
}

