// frontend/merchant-dashboard/adapters/RequestShapeAdapter.ts

export class RequestShapeAdapter {
  public toSnake<T extends Record<string, any>>(camel: T): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(camel)) {
      const snake = key
        .replace(/([A-Z])/g, '_$1')
        .replace(/__/g, '_')
        .toLowerCase();
      out[snake] = value;
    }
    return out;
  }
}
