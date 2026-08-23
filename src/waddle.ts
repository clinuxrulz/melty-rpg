// A field of ~1000 blocky ducks. Each duck has its own phase, speed and wander
// so the crowd feels alive rather than a marching grid; the bodies bob, nod
// and rock side-to-side as they waddle, and turn around at the field's edges.

import { InstancedMesh, Matrix4 } from "@random-mesh/rmsl/scene";

export const DUCK_COUNT = 1000;

/** The waddling ground: a rectangle on the XZ plane. */
const FIELD = { xMin: -26, xMax: 26, zMin: -17, zMax: 17 };

/**
 * A deterministic 0..1 value per (index, salt), so every duck's behaviour is
 * fixed the moment it is created — no per-duck random state to carry around.
 */
function hash(index: number, salt: number): number {
  let h = (index * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  // The trailing xorshift leaves h as a signed int32; re-unsigned it so the
  // value fills [0, 1) instead of [-0.5, 0.5).
  return (h >>> 0) / 4294967296;
}

const wrapAngle = (angle: number) => {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

type Duck = {
  x: number;
  z: number;
  heading: number;
  wanderTarget: number;
  phase: number;
  speed: number;
  wander: number;
  stepFreq: number;
  scale: number;
  bobAmp: number;
  rockAmp: number;
  nodAmp: number;
};

export class DuckField {
  readonly ducks: Duck[] = [];

  // Scratch matrices, reused every frame so the simulation allocates nothing.
  private readonly tmpZ = new Matrix4();
  private readonly tmpX = new Matrix4();
  private readonly tmpY = new Matrix4();
  private readonly tmpT = new Matrix4();
  private readonly tmpS = new Matrix4();

  constructor(count = DUCK_COUNT) {
    for (let i = 0; i < count; i++) {
      const x = FIELD.xMin + 2 + hash(i, 1) * (FIELD.xMax - FIELD.xMin - 4);
      const z = FIELD.zMin + 2 + hash(i, 2) * (FIELD.zMax - FIELD.zMin - 4);
      this.ducks.push({
        x,
        z,
        heading: hash(i, 3) * Math.PI * 2,
        wanderTarget: hash(i, 4) * Math.PI * 2,
        phase: hash(i, 5) * Math.PI * 2,
        speed: 0.35 + hash(i, 6) * 0.6,
        wander: 0.15 + hash(i, 7) * 0.4,
        stepFreq: 3.2 + hash(i, 8) * 2.2,
        scale: 0.8 + hash(i, 9) * 0.4,
        bobAmp: 0.03 + hash(i, 10) * 0.05,
        rockAmp: 0.12 + hash(i, 11) * 0.12,
        nodAmp: 0.06 + hash(i, 12) * 0.08,
      });
    }
  }

  /** Advance every duck by `dt` seconds. */
  update(dt: number, time: number): void {
    for (const duck of this.ducks) {
      // The heading eases toward a slowly drifting target, so a duck turns
      // around by itself instead of tracing one fixed circle.
      const target = duck.wanderTarget + Math.sin(time * duck.wander + duck.phase) * 0.7;
      duck.heading += wrapAngle(target - duck.heading) * Math.min(1, dt * 1.2);

      // +z is the model's front, so a heading of 0 walks it toward +z.
      duck.x += Math.sin(duck.heading) * duck.speed * dt;
      duck.z += Math.cos(duck.heading) * duck.speed * dt;

      // Bounce off the field's edges by turning the duck around.
      if (duck.x < FIELD.xMin) {
        duck.x = FIELD.xMin;
        duck.heading = Math.PI - duck.heading;
      } else if (duck.x > FIELD.xMax) {
        duck.x = FIELD.xMax;
        duck.heading = Math.PI - duck.heading;
      }
      if (duck.z < FIELD.zMin) {
        duck.z = FIELD.zMin;
        duck.heading = -duck.heading;
      } else if (duck.z > FIELD.zMax) {
        duck.z = FIELD.zMax;
        duck.heading = -duck.heading;
      }
    }
  }

  /** Compose each duck's pose into the InstancedMesh's per-instance matrices. */
  writeMatrices(mesh: InstancedMesh, time: number): void {
    const array = mesh.instanceMatrix.array as Float32Array;

    for (let i = 0; i < mesh.count; i++) {
      const duck = this.ducks[i];

      // Waddle: a body that bobs up and down, nods into each step, and rocks
      // side to side about its forward axis. Two steps per rock, so the rock
      // alternates which foot takes the weight.
      const bob = duck.bobAmp * Math.sin(time * duck.stepFreq + duck.phase);
      const rock = duck.rockAmp * Math.sin(time * duck.stepFreq * 2 + duck.phase);
      const nod = duck.nodAmp * Math.sin(time * duck.stepFreq * 2 + duck.phase * 1.3);

      // pose = T * Ry(heading) * Rx(nod) * Rz(rock) * S(scale)
      this.tmpZ.makeRotationZ(rock);
      this.tmpX.makeRotationX(nod);
      this.tmpZ.premultiply(this.tmpX); // Ry is composed below, so this is X*Z
      this.tmpY.makeRotationY(duck.heading);
      this.tmpZ.premultiply(this.tmpY); // Y*X*Z
      // The volume's feet sit at box-local y = -0.5, so +0.5 lifts them onto
      // the ground before the waddle bob moves them off it.
      this.tmpT.makeTranslation(duck.x, 0.5 + bob, duck.z);
      this.tmpZ.premultiply(this.tmpT); // T*Y*X*Z
      this.tmpS.makeScale(duck.scale, duck.scale, duck.scale);
      this.tmpZ.multiply(this.tmpS); // T*Y*X*Z*S

      array.set(this.tmpZ.elements, i * 16);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }
}
