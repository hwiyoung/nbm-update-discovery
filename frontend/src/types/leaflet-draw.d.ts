// leaflet-draw — 공식 @types 패키지가 leaflet@1.9 호환 이슈가 있어 최소 보강 선언만 둠.
// 본 모듈은 import "leaflet-draw" 부수효과로 L.Draw 네임스페이스를 추가한다.
import type * as L from "leaflet";

declare module "leaflet" {
  namespace Draw {
    namespace Event {
      const CREATED: string;
      const EDITED: string;
      const DELETED: string;
      const DRAWSTART: string;
      const DRAWSTOP: string;
      const EDITSTART: string;
      const EDITSTOP: string;
    }

    interface DrawOptions {
      shapeOptions?: L.PathOptions;
      allowIntersection?: boolean;
      showArea?: boolean;
      [key: string]: unknown;
    }

    class Polygon {
      constructor(map: L.Map, options?: DrawOptions);
      enable(): void;
      disable(): void;
    }

    class Rectangle {
      constructor(map: L.Map, options?: DrawOptions);
      enable(): void;
      disable(): void;
    }

    class Circle {
      constructor(map: L.Map, options?: DrawOptions);
      enable(): void;
      disable(): void;
    }
  }
}
