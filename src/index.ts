import { ApplicationBootstrapper } from '/src/bootstrap/ApplicationBootstrapper';

async function main(): Promise<void> {
  const boot = new ApplicationBootstrapper();
  try {
    await boot.boot();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to start application:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  }
}

void main();
