import { useMemo, useState } from 'react';
import './CityMap.css';

// Any agent's "one or two points on a map" need — Service Observability's
// circuit endpoints (real city always known) and Service Order's ports
// (city sometimes still unknown, e.g. a brand-new port before geocoding
// resolves) both fit this same shape structurally, so neither needs its
// own separate type. `color` lets a caller distinguish two points visually
// (e.g. source vs. destination) — omitted, both points fall back to this
// app's accent color, preserving every existing caller's current look
// exactly.
export interface CityMapPoint {
  latitude: number;
  longitude: number;
  city?: string;
  color?: string;
}

// Hand-built against raw OpenStreetMap tiles (no mapping library, no API
// key) to match this app's existing charts (LineChart/Gauge are hand-built
// SVG too) rather than pulling in a dependency for one small map. The
// tile math below is the standard "slippy map" Web Mercator projection —
// see https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames.
const TILE_SIZE = 256;
const MIN_ZOOM = 2;
// Capped at city scale rather than street level — the two endpoints are
// occasionally in the same city (or even building), and there's nothing
// more useful to show by zooming in past this.
const MAX_ZOOM = 13;
// Used only as a bare fallback when a caller renders without width/height
// props at all — both the Service Observability Agent's panel (dynamically
// measured via ResizeObserver, since its map is full-width in a
// user-resizable split) and the Service Reliability Agent's panel (a fixed
// size tuned for its own layout) always pass their own explicit width/
// height instead.
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 170;
// The two points are only allowed to span this fraction of the box at the
// chosen zoom — the rest is margin, so neither marker sits flush against
// an edge.
const FIT_PADDING_RATIO = 0.6;
// Fixed zoom for the single-point case (only `from` or only `to` given,
// e.g. one side of a Connection order not resolved yet) — there's no
// second point to fit bounds against, so this is just a reasonable
// city-level view centered on the one point that exists.
const SINGLE_POINT_ZOOM = 9;
// WorldMap's fixed view when there's no specific circuit to plot — roughly
// centered over Europe/Africa so several continents are visible at once.
// Zoom 2 (not 1): at zoom 1 the whole Mercator world is only 512px wide,
// narrower than this map's typical width, which wrapped the tile grid
// around itself into a visible duplicate seam; zoom 2's 1024px-wide world
// comfortably avoids that for any reasonable map size here.
const WORLD_CENTER = { longitude: 10, latitude: 15 };
const WORLD_ZOOM = 2;

interface WorldPixel {
  x: number;
  y: number;
}

function lonLatToWorldPixel(lon: number, lat: number, zoom: number): WorldPixel {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * worldSize;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * worldSize;
  return { x, y };
}

function chooseZoom(
  from: CityMapPoint,
  to: CityMapPoint,
  width: number,
  height: number,
): number {
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const a = lonLatToWorldPixel(from.longitude, from.latitude, zoom);
    const b = lonLatToWorldPixel(to.longitude, to.latitude, zoom);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx <= width * FIT_PADDING_RATIO && dy <= height * FIT_PADDING_RATIO) {
      return zoom;
    }
  }
  return MIN_ZOOM;
}

interface Tile {
  key: string;
  zoom: number;
  tileX: number;
  tileY: number;
  left: number;
  top: number;
}

// Shared by CityMap and WorldMap below — given a center point (in world
// pixels at some zoom) and a box size, returns exactly the OSM tiles
// needed to cover that box plus each tile's pixel offset within it.
function tileGrid(centerWorldPixel: WorldPixel, zoom: number, width: number, height: number): Tile[] {
  const tileCount = Math.pow(2, zoom);
  const originX = centerWorldPixel.x - width / 2;
  const originY = centerWorldPixel.y - height / 2;

  const minTileX = Math.floor(originX / TILE_SIZE);
  const maxTileX = Math.floor((originX + width) / TILE_SIZE);
  const minTileY = Math.floor(originY / TILE_SIZE);
  const maxTileY = Math.floor((originY + height) / TILE_SIZE);

  const collected: Tile[] = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
    if (tileY < 0 || tileY >= tileCount) continue; // Mercator Y doesn't wrap
    for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount; // X wraps around the globe
      collected.push({
        key: `${zoom}-${wrappedX}-${tileY}-${tileX}`,
        zoom,
        tileX: wrappedX,
        tileY,
        left: tileX * TILE_SIZE - originX,
        top: tileY * TILE_SIZE - originY,
      });
    }
  }
  return collected;
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <>
      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={`https://tile.openstreetmap.org/${tile.zoom}/${tile.tileX}/${tile.tileY}.png`}
          alt=""
          className="city-map-tile"
          style={{ left: tile.left, top: tile.top }}
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      ))}
    </>
  );
}

interface SizeProps {
  width?: number;
  height?: number;
}

// Rendered in the route map's place while it's still loading, or while
// there's no target circuit yet — same outer card + exact same box size
// as whichever real map will replace it, so surrounding layout never
// reflows once real content (or WorldMap, see below) arrives a beat
// later.
export function CityMapLoading({ width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }: SizeProps) {
  return (
    <div className="city-map-card">
      <div className="city-map" style={{ width, height }}>
        <div className="city-map-loading">
          <span className="city-map-loading-dot" />
          <span className="city-map-loading-dot" />
          <span className="city-map-loading-dot" />
        </div>
      </div>
    </div>
  );
}

// Generic, un-zoomed world view with no markers — shown in place of
// CityMap when there's no specific circuit (and therefore no two points)
// to plot yet, e.g. the Service Reliability Agent's map area before any
// Reliability Rule has been created.
export function WorldMap({ width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }: SizeProps) {
  const tiles = useMemo(() => {
    const center = lonLatToWorldPixel(WORLD_CENTER.longitude, WORLD_CENTER.latitude, WORLD_ZOOM);
    return tileGrid(center, WORLD_ZOOM, width, height);
  }, [width, height]);

  return (
    <div className="city-map-card">
      <div className="city-map" style={{ width, height }}>
        <Tiles tiles={tiles} />
        <span className="city-map-attribution">© OpenStreetMap contributors</span>
      </div>
    </div>
  );
}

interface CityMapProps extends SizeProps {
  // Either can be omitted — e.g. a Connection order where only one side
  // has resolved to a real port/coordinate yet. Renders nothing at all
  // (not an empty box) if neither is given; the caller decides what to
  // show instead (CityMapLoading/WorldMap, or simply nothing).
  from?: CityMapPoint;
  to?: CityMapPoint;
}

const DEFAULT_MARKER_COLOR = 'var(--color-accent)';

export default function CityMap({ from, to, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }: CityMapProps) {
  // Hovered city label only — the connecting line/markers themselves are
  // always visible; only the (potentially long) city name text toggles on
  // hover, so it never permanently covers other content on a small map.
  const [hovered, setHovered] = useState<'from' | 'to' | null>(null);

  const layout = useMemo(() => {
    if (from && to) {
      const zoom = chooseZoom(from, to, width, height);
      const a = lonLatToWorldPixel(from.longitude, from.latitude, zoom);
      const b = lonLatToWorldPixel(to.longitude, to.latitude, zoom);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const originX = center.x - width / 2;
      const originY = center.y - height / 2;
      return {
        tiles: tileGrid(center, zoom, width, height),
        fromPoint: { left: a.x - originX, top: a.y - originY },
        toPoint: { left: b.x - originX, top: b.y - originY },
      };
    }
    // Single-point case: no bounds to fit, just center on whichever one
    // point exists at a fixed city-level zoom.
    const only = (from ?? to)!;
    const zoom = SINGLE_POINT_ZOOM;
    const p = lonLatToWorldPixel(only.longitude, only.latitude, zoom);
    const originX = p.x - width / 2;
    const originY = p.y - height / 2;
    const point = { left: p.x - originX, top: p.y - originY };
    return {
      tiles: tileGrid(p, zoom, width, height),
      fromPoint: from ? point : undefined,
      toPoint: to ? point : undefined,
    };
  }, [from, to, width, height]);

  if (!from && !to) return null;

  const { tiles, fromPoint, toPoint } = layout;

  return (
    <div className="city-map-card">
      <div className="city-map" style={{ width, height }}>
        <Tiles tiles={tiles} />

        <svg className="city-map-overlay" width={width} height={height}>
          {fromPoint && toPoint && (
            <line
              x1={fromPoint.left}
              y1={fromPoint.top}
              x2={toPoint.left}
              y2={toPoint.top}
              className="city-map-line"
            />
          )}
          {(
            [
              from && fromPoint ? { key: 'from' as const, point: fromPoint, data: from } : null,
              to && toPoint ? { key: 'to' as const, point: toPoint, data: to } : null,
            ].filter(Boolean) as { key: 'from' | 'to'; point: { left: number; top: number }; data: CityMapPoint }[]
          ).map(({ key, point, data }) => (
            <g
              key={key}
              className="city-map-marker"
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
              style={{ ['--city-map-marker-color' as string]: data.color ?? DEFAULT_MARKER_COLOR }}
            >
              <circle cx={point.left} cy={point.top} r={8} className="city-map-marker-ring" />
              <circle cx={point.left} cy={point.top} r={3.5} className="city-map-marker-dot" />
            </g>
          ))}
        </svg>

        {hovered === 'from' && fromPoint && from?.city && (
          <span className="city-map-city-label" style={{ left: fromPoint.left, top: fromPoint.top }}>
            {from.city}
          </span>
        )}
        {hovered === 'to' && toPoint && to?.city && (
          <span className="city-map-city-label" style={{ left: toPoint.left, top: toPoint.top }}>
            {to.city}
          </span>
        )}

        <span className="city-map-attribution">© OpenStreetMap contributors</span>
      </div>
    </div>
  );
}
