// shp-write 와 dxf-writer 는 공식 타입 패키지가 없어 최소 ambient 선언만 둠.
declare module "shp-write" {
  type ShpWriteFeatureCollection = {
    type: "FeatureCollection";
    features: unknown[];
  };
  interface ShpWriteOptions {
    folder?: string;
    types?: { polygon?: string; polyline?: string; point?: string };
  }
  const api: {
    download: (data: ShpWriteFeatureCollection, opts?: ShpWriteOptions) => void;
    write: (
      data: ShpWriteFeatureCollection,
      callback: (err: unknown, files: unknown) => void,
    ) => void;
    zip: (data: ShpWriteFeatureCollection, opts?: ShpWriteOptions) => string;
  };
  export default api;
}

// jszip 2.5.0 (shp-write 의 transitive dep) 동기 API 의 최소 ambient 선언.
declare module "jszip" {
  interface JSZip2 {
    load(data: string | ArrayBuffer | Uint8Array, options?: { base64?: boolean }): JSZip2;
    file(name: string, data: string | ArrayBuffer | Uint8Array): JSZip2;
    files: Record<string, unknown>;
    generate(options?: {
      type?: "base64" | "string" | "uint8array" | "arraybuffer" | "blob" | "nodebuffer";
      base64?: boolean;
      compression?: "STORE" | "DEFLATE";
    }): string | Blob | Uint8Array | ArrayBuffer;
  }
  const JSZip: new () => JSZip2;
  export default JSZip;
}

declare module "dxf-writer" {
  class Drawing {
    addLayer(name: string, color: number, lineType: string): void;
    setActiveLayer(name: string): void;
    drawPolyline(points: [number, number][], closed: boolean): void;
    toDxfString(): string;
    static ACI: Record<string, number>;
  }
  export default Drawing;
}
