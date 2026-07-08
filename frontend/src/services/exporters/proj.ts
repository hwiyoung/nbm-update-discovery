import proj4 from "proj4";

/**
 * EPSG:4326 ↔ EPSG:5186 정의 등록.
 *
 * 5186 (Korea 2000 / Central Belt 2010) 정의는 국토지리정보원 표준.
 */
const EPSG_5186 =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

if (!proj4.defs("EPSG:5186")) {
  proj4.defs("EPSG:5186", EPSG_5186);
}

export function convert4326to5186(lonLat: [number, number]): [number, number] {
  const [x, y] = proj4("EPSG:4326", "EPSG:5186", lonLat);
  return [x, y];
}

export function convertPolygon4326to5186(coordinates: number[][][]): number[][][] {
  return coordinates.map((ring) =>
    ring.map(([lon, lat]) => convert4326to5186([lon, lat])),
  );
}

/**
 * 5186 의 PRJ 컨텐츠 (.prj 파일용).
 */
export const PRJ_5186 = `PROJCS["Korea 2000 / Central Belt 2010",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea_2000",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],TOWGS84[0,0,0,0,0,0,0],AUTHORITY["EPSG","6737"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4737"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["X",NORTH],AXIS["Y",EAST],AUTHORITY["EPSG","5186"]]`;
