// src/delegates/SqlInListBuilder.ts

export class SqlInListBuilder {
  buildInClause(
    column: string,
    values: Array<string | number>,
  ): { clause: string; params: Array<string | number> } {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('values must be a non-empty array');
    }
    for (const v of values) {
      const t = typeof v;
      if (t !== 'string' && t !== 'number') {
        throw new Error('values must contain only strings or numbers');
      }
    }
    const placeholders = values.map(() => '?').join(',');
    return {
      clause: `${column} IN (${placeholders})`,
      params: values,
    };
  }
}
