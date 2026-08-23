// A small blocky duck, generated voxel by voxel so the demo has something to
// waddle before the user opens a model from rm-stacker. The duck is drawn in a
// 24×24×24 grid (x right, y up, z toward the viewer / the model's front) and
// projected onto the six side bitmaps exactly the way the ray marcher reads
// them back (see voxel-solver.ts), so the two always agree.

import { Bitmap, Dimensions3D } from "./maths";
import { LoadedModel, SideKind } from "./load-model";
import { DUCK_PALETTE } from "./duck-palette";

const N = 24;

const inEllipsoid = (
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
) => {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const dz = (z - cz) / rz;
  return dx * dx + dy * dy + dz * dz <= 1;
};

const inBox = (
  x: number,
  y: number,
  z: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;

/** The palette index of the voxel at (x, y, z), or null for empty space. */
const voxelAt = (x: number, y: number, z: number): number | null => {
  // Body: a squat ellipsoid with its base on the grid floor.
  if (inEllipsoid(x, y, z, 11.5, 7.5, 11.5, 7.5, 7.5, 7)) return 1;

  // Wings, a shade lighter than the body, hugging the body's sides.
  if (
    inEllipsoid(x, y, z, 3.8, 8, 11.5, 2.2, 5, 5) &&
    inEllipsoid(x, y, z, 11.5, 7.5, 11.5, 7.5, 7.5, 7)
  ) {
    return 3;
  }
  if (
    inEllipsoid(x, y, z, 19.2, 8, 11.5, 2.2, 5, 5) &&
    inEllipsoid(x, y, z, 11.5, 7.5, 11.5, 7.5, 7.5, 7)
  ) {
    return 3;
  }

  // Neck: a column lifting from the body to the head.
  if (inBox(x, y, z, 9, 14, 12, 17, 11, 16)) return 1;

  // Head: a sphere perched on the neck, nudged toward the front.
  if (inEllipsoid(x, y, z, 11.5, 18.5, 13.5, 4.6, 4.4, 4.6)) return 1;

  // Beak: a blunt orange wedge on the head's front.
  if (inBox(x, y, z, 9.5, 13.5, 16.5, 18.5, 17.5, 20.5)) return 2;

  // Eyes: a dark pixel on each side of the head's front.
  if (inBox(x, y, z, 8.5, 9.5, 17, 18.5, 17.5, 18.5)) return 0;
  if (inBox(x, y, z, 13.5, 14.5, 17, 18.5, 17.5, 18.5)) return 0;

  // Tail: a small wedge pointing up and back.
  if (inEllipsoid(x, y, z, 11.5, 12.5, 2.5, 3.5, 4, 2.8) && z < 6) return 1;

  return null;
};

/** Which grid axis the projection of a side runs along, and its two fixed ones. */
type Projection = {
  axis: "x" | "y" | "z";
  /** (px, py) of the side bitmap → (x, y, z) grid point the column passes through. */
  fixed: (px: number, py: number) => [number, number, number];
  /** Where along the axis the visible (surface) voxel sits: smallest or largest. */
  limit: "min" | "max";
};

// The pixel layout matches createViews in voxel-solver.ts, so what is drawn on
// each side lines up with the face colour the marcher reads for that voxel.
const PROJECTIONS: Record<SideKind, Projection> = {
  front: { axis: "z", fixed: (px, py) => [px, N - 1 - py, 0], limit: "max" },
  back: { axis: "z", fixed: (px, py) => [N - 1 - px, N - 1 - py, 0], limit: "min" },
  left: { axis: "x", fixed: (px, py) => [0, N - 1 - py, px], limit: "min" },
  right: { axis: "x", fixed: (px, py) => [0, N - 1 - py, N - 1 - px], limit: "max" },
  top: { axis: "y", fixed: (px, py) => [px, 0, py], limit: "max" },
  bottom: { axis: "y", fixed: (px, py) => [px, 0, N - 1 - py], limit: "min" },
};

export function defaultDuckModel(): LoadedModel {
  const sides = {} as Record<SideKind, Bitmap>;

  for (const kind of Object.keys(PROJECTIONS) as SideKind[]) {
    const { axis, fixed, limit } = PROJECTIONS[kind];
    const bitmap = Bitmap.create(N, N);

    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const [fx, fy, fz] = fixed(px, py);
        const [x, y, z] = axis === "x" ? [0, fy, fz] : axis === "y" ? [fx, 0, fz] : [fx, fy, 0];

        // Walk the projection axis, keeping the surface voxel closest to the
        // side this bitmap looks at.
        let surface: number | null = null;
        for (let i = 0; i < N; i++) {
          const [vx, vy, vz] = axis === "x" ? [i, y, z] : axis === "y" ? [x, i, z] : [x, y, i];
          const colour = voxelAt(vx, vy, vz);
          if (colour !== null) {
            surface = colour;
            if (limit === "min") break;
          }
        }
        if (surface !== null) {
          bitmap.data[py * N + px] = surface;
        }
      }
    }
    sides[kind] = bitmap;
  }

  return {
    sides,
    palette: DUCK_PALETTE,
    dimensions: { width: N, height: N, depth: N } as Dimensions3D,
  };
}
