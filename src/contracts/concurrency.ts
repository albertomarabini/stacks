// ../contracts/concurrency.ts

// Concurrency & Synchronization Handling

/**
 * Single-flight guard to prevent re-entrant execution within a processing tick.
 * Returns false if an operation is already running and should be skipped.
 */
export interface ReentrancyGuard {
  guardReentrancy(): boolean;
}

/**
 * In-flight de-duplication for retryable operations (e.g., webhooks).
 * Key represents a logical context (storeId + invoiceId/subscriptionId + eventType).
 */
export interface RetryDeduper {
  isInflight(key: string): boolean;
  markInflight(key: string): void;
  clearInflight(key: string): void;
}

// Error Handling & Fault Tolerance

/**
 * Webhook retry backoff and attempt cap policy.
 * maxAttempts is a literal type of 5 to encode the fixed cap.
 */
export interface WebhookRetryPolicy {
  maxAttempts: 5;
  backoffSeconds: number[]; // e.g., [0, 60, 120, 240, 480, 960]
}

/**
 * Resilience configuration for the payment poller.
 * minConfirmations and reorgWindowBlocks come from configuration.
 * singleFlightPerTick is a literal true, enforcing reentrancy prevention per tick.
 */
export interface PollerResilience {
  minConfirmations: number;
  reorgWindowBlocks: number;
  singleFlightPerTick: true;
}
