import type { IStorage } from './types';

export type RestStoreOptions = {
  /** Base URL ending with `/` or not — paths are joined as `{base}/kv/{key}`. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * Generic document KV over HTTP.
 * - GET  `{base}/kv/{key}` → body text (404 → null)
 * - PUT  `{base}/kv/{key}` + text/plain body
 * - DELETE `{base}/kv/{key}` (404 ok)
 */
export class RestStore implements IStorage {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RestStoreOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/?$/, '/');
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  private url(key: string): string {
    return new URL(`kv/${encodeURIComponent(key)}`, this.baseUrl).toString();
  }

  async getItem(key: string): Promise<string | null> {
    const res = await this.fetchImpl(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RestStore getItem failed: HTTP ${res.status}`);
    return res.text();
  }

  async setItem(key: string, value: string): Promise<void> {
    const res = await this.fetchImpl(this.url(key), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: value,
    });
    if (!res.ok) throw new Error(`RestStore setItem failed: HTTP ${res.status}`);
  }

  async removeItem(key: string): Promise<void> {
    const res = await this.fetchImpl(this.url(key), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`RestStore removeItem failed: HTTP ${res.status}`);
    }
  }
}
