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

  /*
    Declared as a default export only. The named exports exist on the CommonJS
    object but Node cannot detect them statically in the bundled dist, so
    importing them by name typechecks and then fails at runtime. Keeping the
    declaration matched to the default keeps that mistake from compiling.
  */
  export interface GifEnc {
    GIFEncoder(options?: { auto?: boolean }): GifEncoderInstance;
    quantize(
      data: Uint8Array | Uint8ClampedArray,
      maxColors: number,
      options?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
    ): GifPalette;
    applyPalette(
      data: Uint8Array | Uint8ClampedArray,
      palette: GifPalette,
      format?: "rgb565" | "rgb444" | "rgba4444",
    ): Uint8Array;
  }

  const gifenc: GifEnc;
  export default gifenc;
}
