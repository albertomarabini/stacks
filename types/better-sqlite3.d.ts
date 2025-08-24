declare module 'better-sqlite3' {
  // Minimal ambient declarations to satisfy TypeScript at runtime.
  // The runtime module is a C++ native binding; we intentionally keep types loose here.
  type RunResult = { changes?: number };
  interface Database {
    prepare(sql: string): any;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    exec(sql: string): void;
  }
  const DatabaseCtor: {
    new (path: string, options?: any): Database;
    (path: string, options?: any): Database;
  };
  export default DatabaseCtor;
}
