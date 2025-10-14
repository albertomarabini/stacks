import { Server } from 'http';

export class ShutdownCoordinator {
  private server: Server;
  private sessionStore?: { close: (cb: () => void) => void };
  private additionalCleanups: Array<() => Promise<void> | void>;

  constructor(
    server: Server,
    sessionStore?: { close: (cb: () => void) => void },
    additionalCleanups?: Array<() => Promise<void> | void>
  ) {
    this.server = server;
    this.sessionStore = sessionStore;
    this.additionalCleanups = additionalCleanups || [];
    this.registerHandlers();
  }

  private registerHandlers(): void {
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('uncaughtException', (err: Error) => this.gracefulShutdown('uncaughtException', err));
  }

  public gracefulShutdown(signal: string, error?: Error): void {
    this.server.close(() => {
      if (this.sessionStore) {
        this.sessionStore.close(() => {
          this.runAdditionalCleanups().then(() => {
            process.exit(0);
          });
        });
      } else {
        this.runAdditionalCleanups().then(() => {
          process.exit(0);
        });
      }
    });
    setTimeout(() => {
      process.exit(1);
    }, 8000).unref();
  }

  private async runAdditionalCleanups(): Promise<void> {
    for (const fn of this.additionalCleanups) {
      await fn();
    }
  }
}
