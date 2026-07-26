/*
  gifenc ships no type declarations. Only the three functions used by
  emoji-art.ts are declared, typed against how they are actually called rather
  than the library's full surface.
*/
declare module "gifenc" {
  export type GifPalette = number[][];

  export interface WriteFrameOptions {
    palette?: GifPalette;
    delay?: number;
    transparent?: boolean;
    solid?: boolean;
    repeat?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { auto?: boolean }): GifEncoderInstance;

  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): GifPalette;

  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
