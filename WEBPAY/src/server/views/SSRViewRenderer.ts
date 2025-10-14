/**
 * /src/server/views/SSRViewRenderer.ts
 *
 * Responsible for rendering all EJS templates SSR, ensures branding, hydration,
 * asset links, and partials are injected as required. Injects CSRF tokens for
 * authenticated POST forms. Never exposes secrets.
 */

import type { Branding, InvoiceDTO, MerchantShellProps } from '../../shared/models/dto';
import type { IBrandingService, IHydrationInjector } from '../../shared/contracts/interfaces';

import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ejs = require('ejs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

/**
 * SSRViewRenderer renders all EJS templates server-side, ensuring branding,
 * hydration, static asset links, and partials are injected as required.
 * Produces fully SSR HTML for every page, including asset references, never
 * leaking secrets or privileged data. Used by controllers and ErrorMiddleware.
 */
export class SSRViewRenderer {
  /**
   * Renders a hidden CSRF token input field for inclusion in every POST form.
   * The token value is retrieved from req.csrfToken() (attached by csurf middleware).
   * @param req Express.Request (must have csrfToken() method)
   * @returns HTML string for hidden input field
   */
  static renderFormWithCSRFToken(req: { csrfToken: () => string }): string {
    const token = req.csrfToken();
    return `<input type="hidden" name="_csrf" value="${token}">`;
  }

  /**
   * Injects static asset references (stylesheet and JS island scripts).
   * - Always injects Tailwind CSS build.
   * - For each island name provided, injects a JS <script> module tag.
   * @param islands Optional array of island script names (without extension)
   * @returns String of HTML <link> and <script> tags
   */
  static injectStaticAssetLinks(islands?: string[]): string {
    let assets = `<link rel="stylesheet" href="/static/css/app.css" />\n`;
    if (Array.isArray(islands)) {
      for (const name of islands) {
        assets += `<script src="/static/js/${name}.js" type="module"></script>\n`;
      }
    }
    return assets;
  }

  /**
   * EJS partial include helper.
   * Renders the provided partial template with the supplied context object.
   * The partial name is resolved relative to the views root (e.g., '_partials/header').
   * @param partial Name of the partial file (relative to views root, w/o .ejs)
   * @param context Context object for the partial
   * @returns Rendered partial as HTML string
   */
  static renderPartialWithContext(partial: string, context: Record<string, any>): string {
    // Use the actual views root
    const viewsRoot = require('path').join(process.cwd(), 'src', 'server', 'views');
    const filename = require('path').join(viewsRoot, `${partial}.ejs`);
    return ejs.render(
      fs.readFileSync(filename, { encoding: 'utf-8' }),
      context,
      { filename, root: viewsRoot }
    );
  }

  /**
   * Returns the correct <title> string for the current page.
   * - If a title is explicitly provided, uses that value.
   * - Otherwise, falls back to branding.displayName.
   * @param title Optional explicit title string
   * @param branding Branding object (must have displayName)
   * @returns Title string
   */
  static setTitleFromBrandingOrOverride(title: string | undefined, branding: Branding): string {
    return typeof title === 'string' && title.trim().length > 0
      ? title
      : branding.displayName;
  }
}
