import type { Request, Response } from 'express';

export class HealthController {
  public getRoot(_req: Request, res: Response): void {
    res.status(200).send('OK');
  }
}
