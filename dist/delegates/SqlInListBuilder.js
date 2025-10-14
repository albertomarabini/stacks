"use strict";
// src/delegates/SqlInListBuilder.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqlInListBuilder = void 0;
class SqlInListBuilder {
    buildInClause(column, values) {
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
exports.SqlInListBuilder = SqlInListBuilder;
//# sourceMappingURL=SqlInListBuilder.js.map