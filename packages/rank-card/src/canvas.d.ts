declare module "@napi-rs/canvas" {
  interface ImageLike {}
  interface CanvasContext {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    font: string;
    textAlign: "left" | "right" | "center" | "start" | "end";
    fillRect(x: number, y: number, width: number, height: number): void;
    strokeRect(x: number, y: number, width: number, height: number): void;
    beginPath(): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    fill(): void;
    save(): void;
    restore(): void;
    clip(): void;
    drawImage(image: ImageLike, x: number, y: number, width: number, height: number): void;
    fillText(text: string, x: number, y: number): void;
  }
  interface Canvas {
    getContext(type: "2d"): CanvasContext;
    toBuffer(type: "image/png"): Buffer;
  }
  export function createCanvas(width: number, height: number): Canvas;
  export function loadImage(source: string): Promise<ImageLike>;
}
