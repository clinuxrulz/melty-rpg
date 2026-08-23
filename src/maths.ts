// Adapted from rm-stacker (MIT, big-mesh-studios) — src/maths.ts.
// Only the pieces the demo needs are kept: the bitmap/palette helpers and the
// 3D dimensions used to pack a model's sides into a voxel texture.

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export namespace Vector3D {
  export function create(x = 0, y = 0, z = 0): Vector3D {
    return { x, y, z };
  }
}

export interface Dimensions3D {
  width: number;
  height: number;
  depth: number;
}

export namespace Dimensions3D {
  /**
   * Scales the three dimensions so the largest is 1. The ray marcher renders
   * the volume in this normalized space (see shaders-shared.ts), and the box
   * bounding it is sized from the result.
   */
  export function normalize(
    dimensions: Dimensions3D,
    out: Dimensions3D = { width: 0, height: 0, depth: 0 },
  ): Dimensions3D {
    const max = Math.max(dimensions.width, dimensions.height, dimensions.depth);
    out.width = dimensions.width / max;
    out.height = dimensions.height / max;
    out.depth = dimensions.depth / max;
    return out;
  }
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Bitmap {
  width: number;
  height: number;
  /** One palette index per cell, row by row. `EMPTY` where nothing is drawn. */
  data: Uint8Array;
}

export namespace Bitmap {
  /**
   * A cell with nothing drawn in it. Zero is a real palette index, so emptiness
   * needs a value of its own rather than falling out of a zero-filled array.
   */
  export const EMPTY = 255;

  export function create(width: number, height: number): Bitmap {
    const data = new Uint8Array(width * height);
    data.fill(EMPTY);
    return { width, height, data };
  }
}
