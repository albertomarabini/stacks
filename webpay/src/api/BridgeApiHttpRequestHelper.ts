export class BridgeApiHttpRequestHelper {
  async doRequest(
    method: 'GET' | 'POST' | 'PATCH',
    baseUrl: string,
    endpoint: string,
    opts: {
      apiKey?: string;
      body?: any;
      query?: Record<string, any>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<any> {
    let url = baseUrl + endpoint;
    if (opts.query) {
      const qs = Object.entries(opts.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as any)}`)
        .join('&');
      if (qs.length > 0) url += (url.includes('?') ? '&' : '?') + qs;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.apiKey ? { 'X-API-Key': opts.apiKey } : {}),
      ...(opts.headers || {})
    };

    const fetchOpts: RequestInit = {
      method,
      headers,
      ...(method !== 'GET' ? { body: opts.body ? JSON.stringify(opts.body) : undefined } : {})
    };

    const resp = await fetch(url, fetchOpts);
    const respText = await resp.text();
    let data: any = undefined;
    try {
      data = respText ? JSON.parse(respText) : undefined;
    } catch (e) {
      throw {
        statusCode: resp.status,
        message: 'Invalid response from Bridge API'
      };
    }

    if (!resp.ok) {
      throw {
        statusCode: data && data.statusCode ? data.statusCode : resp.status,
        message: data && data.error ? data.error : data && data.message ? data.message : 'Bridge API Error'
      };
    }
    return data;
  }
}
