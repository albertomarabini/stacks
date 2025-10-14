import fs from 'fs';
import path from 'path';

export function repoPath(...segs: string[]) {
  // 1) If CWD has package.json, assume we're at repo root (dev/debug)
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    return path.join(cwd, ...segs);
  }
  // 2) Walk up from this file to find the nearest package.json (built/PM2/systemd)
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return path.join(dir, ...segs);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 3) Fallback: dist/src/server/... → repo root is usually ../../..
  return path.resolve(__dirname, '../../..', ...segs);
}
