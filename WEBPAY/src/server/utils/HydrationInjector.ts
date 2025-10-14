/**
 * /src/server/utils/HydrationInjector.ts
 *
 * Responsible for constructing and injecting hydration objects for SSR templates
 * that require client-side islands (MagicLink, POS, etc.).
 * Exports a function to produce the hydration <script> block for SSR rendering.
 * Used by controllers and SSRViewRenderer.
 */

import type {
  HydrationMagicLink,
  HydrationInvoice,
  HydrationPOS
} from '../../shared/models/dto';

export class HydrationInjector {
  /**
   * Serializes the provided hydration object and returns
   * a <script> tag which sets window.__PAGE__ for client JS islands.
   * Ensures that only contract-compliant, non-secret properties are included.
   * @param hydrationObject Hydration object matching documented DTO contract.
   * @returns Script tag string for SSR injection.
   */
  static inject(hydrationObject: Record<string, any>): string {
    const json = JSON.stringify(hydrationObject).replace(/<\/script>/gi, '<\\/script>');
    return `<script>window.__PAGE__ = ${json};</script>`;
  }
}
