// src/types/ejs-mate.d.ts
declare module 'ejs-mate' {
  // ejs-mate’s export is a view engine function compatible with ejs.renderFile
  // (path, options, callback) -> void
  const ejsMate: (
    path: string,
    options: any,
    callback: (err: Error | null, html?: string) => void
  ) => void;

  export default ejsMate;
}
