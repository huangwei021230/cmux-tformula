import { Resvg } from "@resvg/resvg-js";

interface RasterRequest {
  id: number;
  svg: string;
  loadSystemFonts: boolean;
  fontFiles?: string[];
  maxDimension: number;
  maxPixels: number;
  maxPngBytes: number;
}

interface RasterSuccess {
  id: number;
  ok: true;
  png: Buffer;
}

interface RasterFailure {
  id: number;
  ok: false;
  code: "raster-limit" | "empty-raster" | "png-limit" | "raster-error";
  message: string;
}

function hasVisiblePixel(pixels: Buffer): boolean {
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 0) return true;
  }
  return false;
}

function send(message: RasterSuccess | RasterFailure): void {
  if (process.connected) process.send?.(message);
}

process.on("message", async (message: RasterRequest) => {
  if (!message || !Number.isSafeInteger(message.id) || typeof message.svg !== "string") return;
  try {
    const renderer = new Resvg(message.svg, {
      fitTo: { mode: "original" },
      font: {
        loadSystemFonts: message.loadSystemFonts,
        ...(message.fontFiles ? { fontFiles: message.fontFiles } : {})
      },
      shapeRendering: 2,
      textRendering: 2,
      logLevel: "error"
    });
    // Check the parsed dimensions before allocating the RGBA raster. This
    // worker is isolated, so a native parse/render panic remains recoverable.
    if (renderer.width < 1 || renderer.height < 1
      || renderer.width > message.maxDimension || renderer.height > message.maxDimension
      || renderer.width * renderer.height > message.maxPixels) {
      send({
        id: message.id,
        ok: false,
        code: "raster-limit",
        message: `formula raster ${renderer.width}x${renderer.height} exceeds limits (${message.maxDimension}px per side, ${message.maxPixels} pixels total)`
      });
      return;
    }
    const rendered = renderer.render();
    if (!hasVisiblePixel(rendered.pixels)) {
      send({
        id: message.id,
        ok: false,
        code: "empty-raster",
        message: "formula raster contains no visible pixels"
      });
      return;
    }
    const png = rendered.asPng();
    if (png.byteLength > message.maxPngBytes) {
      send({
        id: message.id,
        ok: false,
        code: "png-limit",
        message: `formula PNG exceeds ${message.maxPngBytes} bytes`
      });
      return;
    }
    send({ id: message.id, ok: true, png });
  } catch (error) {
    send({
      id: message.id,
      ok: false,
      code: "raster-error",
      message: `formula rasterization failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

process.on("disconnect", () => process.exit(0));
