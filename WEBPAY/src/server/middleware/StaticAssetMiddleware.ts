// src/server/middleware/StaticAssetMiddleware.ts
import express from 'express';
import path from 'path';
import { repoPath } from '../utils/repoPath';

export const StaticAssetMiddleware = express.static(
  // maps request "/static/..." → disk "<repo>/public/static/..."
  repoPath('public', 'static'),
  {
    index: false,
    immutable: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
    fallthrough: false, // return 404 right away if file missing
    setHeaders(res, filePath) {
      // mildly helpful content types (Express usually gets these right anyway)
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
      if (filePath.endsWith('.js'))  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }
);
