import { RGBA } from "./maths";

/**
 * The demo's default palette, used when a model's zip carries none of its own:
 * a full row of 32 texels so the shader's `(index + 0.5) / 32` sampling (see
 * shaders-shared.ts) lands on the right colour. Slots 0-3 are the duck proper —
 * dark for eyes/shadow, yellow body, orange beak, pale belly/wing — and the
 * rest ramp yellow into orange so a model that reaches past index 3 still
 * reads as duck-coloured.
 */
export const DUCK_PALETTE: RGBA[] = Array.from({ length: 32 }, (_, i) => {
  if (i === 0) return { r: 40, g: 34, b: 26, a: 255 }; // dark (eyes / shadow)
  if (i === 1) return { r: 244, g: 197, b: 49, a: 255 }; // yellow body
  if (i === 2) return { r: 232, g: 106, b: 23, a: 255 }; // orange beak
  if (i === 3) return { r: 230, g: 226, b: 214, a: 255 }; // pale belly/wing
  const t = (i - 4) / 27;
  return {
    r: Math.round(244 - (244 - 232) * t),
    g: Math.round(197 - (197 - 106) * t),
    b: Math.round(49 - (49 - 23) * t),
    a: 255,
  };
});
