// src/delegates/WebhookSignatureService.ts
import crypto from 'crypto';

type VerifyOk = { ok: true };
type VerifyFail = { ok: false; status: 401 | 409 };

export class WebhookSignatureService {
  private readonly maxSkewSeconds: number;
  private readonly replayTtlSeconds: number;
  private readonly replayCache = new Map<string, number>();

  constructor(maxSkewSeconds: number = 300, replayTtlSeconds: number = 600) {
    this.maxSkewSeconds = maxSkewSeconds;
    this.replayTtlSeconds = replayTtlSeconds;
  }

  buildOutboundHeaders(
    secret: string,
    rawBody: string,
    nowEpochSecs: number,
  ): { headers: Record<string, string>; signatureHex: string; timestamp: number } {
    const signatureHex = crypto
      .createHmac('sha256', secret)
      .update(`${nowEpochSecs}.${rawBody}`)
      .digest('hex');
    return {
      signatureHex,
      timestamp: nowEpochSecs,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Timestamp': String(nowEpochSecs),
        'X-Webhook-Signature': `v1=${signatureHex}`,
      },
    };
  }

  verifyInbound(
    tsHeader: string | undefined,
    sigHeader: string | undefined,
    rawBody: string,
    secret: string,
    nowEpochSecs: number,
  ): VerifyOk | VerifyFail {
    if (!tsHeader || !sigHeader) return { ok: false, status: 401 };

    const ts = Number(tsHeader);
    if (!Number.isFinite(ts) || Math.abs(nowEpochSecs - ts) > this.maxSkewSeconds) {
      return { ok: false, status: 401 };
    }

    const seenAt = this.replayCache.get(sigHeader);
    if (seenAt && nowEpochSecs - seenAt <= this.replayTtlSeconds) {
      return { ok: false, status: 409 };
    }

    const presented = sigHeader.startsWith('v1=') ? sigHeader.slice(3) : sigHeader;
    const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(presented, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, status: 401 };
    }

    this.replayCache.set(sigHeader, nowEpochSecs);
    for (const [sig, firstSeen] of this.replayCache.entries()) {
      if (nowEpochSecs - firstSeen > this.replayTtlSeconds) {
        this.replayCache.delete(sig);
      }
    }
    return { ok: true };
  }
}

export default WebhookSignatureService;
