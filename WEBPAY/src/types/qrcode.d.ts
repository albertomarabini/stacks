declare module "qrcode" {
    export interface QRCodeToCanvasOptions {
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    }
    export function toCanvas(
      canvas: HTMLCanvasElement,
      text: string,
      opts?: QRCodeToCanvasOptions
    ): Promise<void>;
    const _default: { toCanvas: typeof toCanvas };
    export default _default;
  }
