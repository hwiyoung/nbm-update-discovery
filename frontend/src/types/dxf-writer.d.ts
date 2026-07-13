// dxf-writer는 공식 타입 패키지가 없어 최소 ambient 선언만 둔다.
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
