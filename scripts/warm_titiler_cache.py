"""TiTiler 캐시 사전 워밍 (cache pre-warming).

COG 정사영상의 자주 보는 줌 레벨 타일을 nginx 캐시에 미리 채워둔다.
업로드 직후 background 으로 1회 실행하면 사용자 첫 진입부터 즉시 응답.

사용법:
  docker compose run --rm scripts python scripts/warm_titiler_cache.py [--zoom-max 17] [--all|--id N ...]
  docker compose exec backend python /workspace/scripts/warm_titiler_cache.py --all
"""
from __future__ import annotations

import argparse
import asyncio
import math
import sys
import time
from urllib.parse import quote

import aiohttp

# 본 스크립트는 host 머신에서 실행. 단일 웹 진입점(frontend/nginx) 프록시를 통해 워밍.
WEB_BASE = "http://localhost:18200"
NGINX_BASE = f"{WEB_BASE}/titiler"
BACKEND_BASE = WEB_BASE


def deg2tile(lat: float, lng: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lng + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def tiles_in_bbox(
    minlng: float, minlat: float, maxlng: float, maxlat: float, z: int
) -> list[tuple[int, int]]:
    x0, y1 = deg2tile(minlat, minlng, z)  # SW → maxY
    x1, y0 = deg2tile(maxlat, maxlng, z)  # NE → minY
    xs = range(min(x0, x1), max(x0, x1) + 1)
    ys = range(min(y0, y1), max(y0, y1) + 1)
    return [(x, y) for x in xs for y in ys]


async def fetch_tile(
    session: aiohttp.ClientSession,
    z: int,
    x: int,
    y: int,
    tile_path: str,
) -> tuple[int, int, str]:
    """단일 타일 요청. 응답을 받으면 nginx 가 캐시에 저장."""
    url = (
        f"{NGINX_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png"
        f"?url=file://{quote(tile_path, safe='/')}"
    )
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
            await r.read()
            cache = r.headers.get("X-Cache-Status", "?")
            return (r.status, len(await r.read()) if False else 0, cache)
    except Exception as e:
        return (0, 0, f"ERR:{e}")


async def warm_dataset(
    session: aiohttp.ClientSession,
    dataset_id: int,
    tile_path: str,
    bbox: tuple[float, float, float, float],
    zooms: list[int],
    concurrency: int,
) -> None:
    minlng, minlat, maxlng, maxlat = bbox
    print(f"\n=== dataset #{dataset_id} ({tile_path}) ===")
    print(f"  bbox 4326: {bbox}")

    total_tiles: list[tuple[int, int, int]] = []
    for z in zooms:
        coords = tiles_in_bbox(minlng, minlat, maxlng, maxlat, z)
        total_tiles.extend((z, x, y) for x, y in coords)
        print(f"  z{z}: {len(coords)} tiles")
    print(f"  total: {len(total_tiles)} tiles, concurrency={concurrency}")

    sem = asyncio.Semaphore(concurrency)
    miss_count = 0
    hit_count = 0
    err_count = 0
    start = time.perf_counter()

    async def task(z: int, x: int, y: int) -> None:
        nonlocal miss_count, hit_count, err_count
        async with sem:
            status, _, cache = await fetch_tile(session, z, x, y, tile_path)
            if status == 200:
                if cache == "HIT":
                    hit_count += 1
                else:
                    miss_count += 1
            elif status == 404:
                pass  # 영역 밖 tile — 정상
            else:
                err_count += 1

    await asyncio.gather(*(task(z, x, y) for z, x, y in total_tiles))
    elapsed = time.perf_counter() - start
    print(
        f"  done in {elapsed:.1f}s — MISS(new)={miss_count} HIT(cached)={hit_count} "
        f"ERR={err_count} / {len(total_tiles)}"
    )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zoom-min", type=int, default=14)
    parser.add_argument("--zoom-max", type=int, default=17)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--id", type=int, nargs="+", help="대상 dataset id 들")
    parser.add_argument("--all", action="store_true", help="ready 인 모든 데이터셋")
    args = parser.parse_args()

    async with aiohttp.ClientSession() as session:
        # 대상 dataset 가져오기
        async with session.get(f"{BACKEND_BASE}/api/v1/datasets") as r:
            datasets = await r.json()
        if args.all:
            targets = [d for d in datasets if d.get("status") == "ready" and d.get("tile_path")]
        elif args.id:
            ids = set(args.id)
            targets = [d for d in datasets if d["id"] in ids and d.get("tile_path")]
        else:
            print("--all 또는 --id N 을 지정하세요")
            sys.exit(1)

        if not targets:
            print("처리할 dataset 없음")
            return

        zooms = list(range(args.zoom_min, args.zoom_max + 1))
        for ds in targets:
            # 4326 bbox 를 TiTiler info 로부터 받기
            tile_path = ds["tile_path"]
            info_url = (
                f"{NGINX_BASE}/cog/info?url=file://{quote(tile_path, safe='/')}"
            )
            async with session.get(info_url) as r:
                info = await r.json()
            # info.bounds 가 source CRS 일 수 있음 — tilejson 으로 4326 bbox
            tilejson_url = (
                f"{NGINX_BASE}/cog/WebMercatorQuad/tilejson.json"
                f"?url=file://{quote(tile_path, safe='/')}"
            )
            async with session.get(tilejson_url) as r:
                tj = await r.json()
            bbox = tuple(tj["bounds"])  # [west, south, east, north] in 4326
            await warm_dataset(
                session, ds["id"], tile_path, bbox, zooms, args.concurrency
            )


if __name__ == "__main__":
    asyncio.run(main())
