// Adapted from rm-stacker (MIT, big-mesh-studios) — src/voxel-preview-scene.ts.
// The size of the box bounding the volume, matching the box the ray marcher
// intersects in shaders-shared.ts: the volume (normalized) padded by one voxel
// on each side, so rasterizing it limits the fragment shader to the pixels
// that could possibly land on a voxel.

import { Dimensions3D } from "./maths";

export const boxSize = (dimensions: Dimensions3D) => {
  const normalized = Dimensions3D.normalize(dimensions);
  const scale = (axis: number, count: number) => axis * (1 + 2 / count);
  return {
    width: scale(normalized.width, dimensions.width),
    height: scale(normalized.height, dimensions.height),
    depth: scale(normalized.depth, dimensions.depth),
  };
};
