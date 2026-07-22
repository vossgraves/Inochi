declare module "@napi-rs/canvas" {
  interface ImageLike {
    width: number;
    height: number;
  }
  interface TextMetrics {
    width: number;
  }
  interface CanvasContext {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    font: string;
    textAlign: "left" | "right" | "center" | "start" | "end";
    fillRect(x: number, y: number, width: number, height: number): void;
    strokeRect(x: number, y: number, width: number, height: number): void;
    beginPath(): void;
    closePath(): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    roundRect(x: number, y: number, width: number, height: number, radius: number): void;
    fill(): void;
    stroke(): void;
    save(): void;
    restore(): void;
    clip(): void;
    drawImage(image: ImageLike, x: number, y: number, width: number, height: number): void;
    drawImage(image: ImageLike, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    fillText(text: string, x: number, y: number): void;
    measureText(text: string): TextMetrics;
  }
  interface Canvas {
    getContext(type: "2d"): CanvasContext;
    toBuffer(type: "image/png"): Buffer;
  }
  export function createCanvas(width: number, height: number): Canvas;
  export function loadImage(source: string): Promise<ImageLike>;
}
