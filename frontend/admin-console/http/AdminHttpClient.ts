// ../admin-console/http/AdminHttpClient.ts

export class AdminHttpClient {
  private static readonly base = '/api/admin';

  static async request(
    path: string,
    options: { method: 'GET' | 'POST' | 'PATCH'; authHeader: string; jsonBody?: any }
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: options.authHeader };
    const init: RequestInit = { method: options.method, headers };
    if (options.jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.jsonBody);
    }
    const url = `${this.base}${path.startsWith('/') ? path : '/' + path}`;
    return fetch(url, init);
  }

  static async parseJson<T = any>(resp: Response): Promise<T> {
    const text = await resp.text();
    if (!text) {
      // @ts-expect-error allow undefined when caller expects optional
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}
