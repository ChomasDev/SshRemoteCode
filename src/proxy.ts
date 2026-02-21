import { RemoteExecutor } from './executor';
import { RemoteModule } from './types';

export class RemoteProxy {
  private cache: Map<string, any> = new Map();

  constructor(private executor: RemoteExecutor, private modulePath: string) {}

  createProxy<T = any>(): RemoteModule<T> {
    if (this.cache.has(this.modulePath)) return this.cache.get(this.modulePath);

    const proxy = new Proxy(
      {},
      {
        get: (_target, prop: string | symbol) => {
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
          return async (...args: any[]) => this.executor.executeFunction(this.modulePath, prop, args);
        },
        has: () => true,
        ownKeys: () => [],
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      }
    ) as RemoteModule<T>;

    this.cache.set(this.modulePath, proxy);
    return proxy;
  }

  clearCache(): void {
    this.cache.delete(this.modulePath);
  }
}
