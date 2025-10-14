//index.ts

import 'dotenv/config';
import { ApplicationBootstrapper } from './ApplicationBootstrapper';

ApplicationBootstrapper.bootstrapApplication();


process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection', err);
  });
