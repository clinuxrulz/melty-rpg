/**
 * Ocarina-of-Time-style camera and control scheme, replacing the rigid
 * chase cam from bms-voxelscape.
 *
 * - The camera orbits the player on a boom whose yaw, elevation and
 *   length are stateful. Look-drag drives yaw/elevation directly; nothing
 *   else snaps them.
 * - Movement input is interpreted relative to the CAMERA, not the
 *   character: `applyControls` rewrites the stick vector into the
 *   package's player-relative frame (so `updatePlayer` produces
 *   camera-relative motion) and auto-turns the character toward the stick
 *   direction with a capped turn rate, like Link.
 * - Left alone, the camera swings back behind the character on an angular
 *   spring: gently while running, more deliberately after standing still,
 *   with the slight overshoot-and-settle of the N64 camera.
 * - Terrain awareness uses only the heightfield callback: the eye is kept
 *   above the ground, and the boom shortens when the heightfield rises
 *   between the focus point and the eye (no side-collision raycast).
 */

import {
  PLAYER_CFG,
  type InputSnapshot,
  type Player,
} from "@big-mesh-studios/bms-voxelscape";
import { Vector3, type PerspectiveCamera } from "@random-mesh/rmsl/scene";

export const CAMERA_CFG = {
  /** Boom length from the focus point to the eye, in world units. */
  dist: 9.5,
  /** Resting boom elevation above the horizon, in radians. */
  elevDefault: 0.34,
  elevMin: -0.35,
  elevMax: 1.25,
  /** Seconds without look input before elevation drifts back to rest. */
  elevRelaxDelay: 1.2,
  /** Focus-point chase rate (1/s); higher is tighter. */
  focusRate: 14,
  /** Orbit centre height above the cube centre, in world units. */
  focusUp: 0.6,
  /** Seconds without look input before run-alignment engages. */
  moveAlignDelay: 0.6,
  /** Seconds with the stick released before the idle swing starts. */
  idleRecenterDelay: 0.9,
  /** Ease-in duration of the idle swing once its delay has elapsed. */
  idleRampTime: 0.8,
  /** Angular spring stiffness while running / standing still (1/s^2). */
  kMove: 2.4,
  kIdle: 4.2,
  /** Spring damping as a fraction of critical; below 1 overshoots slightly. */
  dampRatio: 0.85,
  /** Angular speed caps for the two recenter tiers, in radians/s. */
  capMove: 3.0,
  capIdle: 1.8,
  /** Character auto-turn rate, in radians/s. */
  turnSpeed: 7.0,
  /** Stick magnitude below which the character counts as not steering. */
  turnDeadzone: 0.15,
  /** The eye is kept at least this far above the heightfield. */
  groundMargin: 0.7,
  /** Boom occlusion samples along the focus-to-eye segment. */
  pullSamples: 6,
  /** Shortest allowed boom length after terrain pull-in. */
  minDist: 2.0,
  /** Boom length smoothing rates (1/s); pulling in is much faster than releasing. */
  pullInRate: 14,
  releaseRate: 3,
};

export interface OotCamera {
  /** Hard-place the camera behind the player; call once at spawn. */
  snap(camera: PerspectiveCamera, player: Player): void;
  /**
   * Applies the OoT control scheme: drags the orbit by the look deltas,
   * turns the character toward the stick direction relative to the camera,
   * and rewrites `input` in place so its stick vector is relative to the
   * character's heading (what `updatePlayer` expects) while producing
   * camera-relative motion. Look deltas are zeroed — the camera owns them.
   * Call once per frame, before `updatePlayer`.
   */
  applyControls(player: Player, dt: number, input: InputSnapshot): void;
  /**
   * Advances the orbit dynamics (focus chase, recenter spring, terrain)
   * and writes the camera transform. Call once per frame, after
   * `updatePlayer` has moved the player.
   */
  update(camera: PerspectiveCamera, player: Player, dt: number): void;
}

/** Wraps to [-pi, pi]. */
const wrapPi = (a: number): number => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) {
    a += 2 * Math.PI;
  }
  return a - Math.PI;
};

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const smoothstep = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

export const createOotCamera = (
  groundHeightAt: (x: number, z: number) => number,
): OotCamera => {
  const cfg = CAMERA_CFG;

  // Orbit state. camYaw is the boom heading; it deliberately decouples
  // from player.yaw so dragging the camera never spins the character.
  let camYaw = 0;
  let yawVel = 0;
  let elev = cfg.elevDefault;
  let dist = cfg.dist;
  // Seconds since look-drag input; drives every "left alone" behaviour.
  let lookIdle = 0;
  // Stick magnitude captured by applyControls this frame.
  let stickMag = 0;

  const focus = new Vector3();
  const eye = new Vector3();
  const tmp = new Vector3();

  const placeEye = () => {
    const cosElev = Math.cos(elev);
    const dirX = -Math.sin(camYaw) * cosElev;
    const dirY = Math.sin(elev);
    const dirZ = -Math.cos(camYaw) * cosElev;
    eye.set(
      focus.x + dirX * dist,
      focus.y + dirY * dist,
      focus.z + dirZ * dist,
    );
    const floor = groundHeightAt(eye.x, eye.z) + cfg.groundMargin;
    if (eye.y < floor) {
      eye.y = floor;
    }
  };

  return {
    snap(camera, player) {
      camYaw = player.yaw;
      yawVel = 0;
      elev = cfg.elevDefault;
      dist = cfg.dist;
      lookIdle = 0;
      focus.set(
        player.position.x,
        player.position.y + cfg.focusUp,
        player.position.z,
      );
      placeEye();
      camera.position.copy(eye);
      camera.lookAt(focus);
    },

    applyControls(player, dt, input) {
      if (input.lookDx !== 0 || input.lookDy !== 0) {
        lookIdle = 0;
        const sens = PLAYER_CFG.lookSensitivity;
        // Dragging right pans the view rightward: forward is
        // (sin yaw, cos yaw) and screen-right is (-cos yaw, sin yaw),
        // so reaching right means decreasing yaw. Dragging up raises
        // the camera over the target (pointer dy is positive downward).
        camYaw -= input.lookDx * sens;
        elev = clamp(elev - input.lookDy * sens, cfg.elevMin, cfg.elevMax);
        // Manual override kills any in-flight spring motion.
        yawVel = 0;
      } else {
        lookIdle += dt;
      }

      stickMag = Math.hypot(input.moveX, input.moveY);

      if (stickMag > cfg.turnDeadzone) {
        // Desired world heading of the stick, interpreted against the
        // camera instead of the character.
        const wx =
          input.moveY * Math.sin(camYaw) - input.moveX * Math.cos(camYaw);
        const wz =
          input.moveY * Math.cos(camYaw) + input.moveX * Math.sin(camYaw);
        const target = Math.atan2(wx, wz);
        const d = wrapPi(target - player.yaw);
        const maxStep = cfg.turnSpeed * dt;
        player.yaw =
          Math.abs(d) <= maxStep ? target : player.yaw + Math.sign(d) * maxStep;
      }

      // Rewrite the stick into the package's player-relative frame so the
      // resulting WORLD motion matches the stick relative to the camera:
      // the package computes v = my*(sin yaw, cos yaw) + mx*(-cos yaw, sin yaw),
      // which equals the camera-relative vector exactly when (my', mx') is
      // the stick pair rotated by phi = player.yaw - camYaw.
      const phi = player.yaw - camYaw;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const mx = input.moveX;
      const my = input.moveY;
      input.moveY = my * c - mx * s;
      input.moveX = mx * c + my * s;
      input.lookDx = 0;
      input.lookDy = 0;
    },

    update(camera, player, dt) {
      // Chase the focus point so landings don't jolt the camera.
      tmp.set(
        player.position.x,
        player.position.y + cfg.focusUp,
        player.position.z,
      );
      focus.lerp(tmp, Math.min(1, cfg.focusRate * dt));

      // Two-tier recenter spring toward directly behind the character:
      // weak alignment while running, a slower stately swing when idle.
      const diff = wrapPi(player.yaw - camYaw);
      let k = 0;
      let cap = 0;
      if (stickMag > cfg.turnDeadzone && lookIdle > cfg.moveAlignDelay) {
        k = cfg.kMove;
        cap = cfg.capMove;
      } else if (
        stickMag <= cfg.turnDeadzone &&
        lookIdle > cfg.idleRecenterDelay
      ) {
        const ramp = smoothstep(
          (lookIdle - cfg.idleRecenterDelay) / cfg.idleRampTime,
        );
        k = cfg.kIdle * (0.25 + 0.75 * ramp);
        cap = Math.max(cfg.capIdle * ramp, 0.05);
      }
      if (k > 0) {
        const damp = cfg.dampRatio * 2 * Math.sqrt(k);
        yawVel += (k * diff - damp * yawVel) * dt;
        yawVel = clamp(yawVel, -cap, cap);
        camYaw += yawVel * dt;
      } else {
        yawVel *= Math.exp(-8 * dt);
      }

      // Elevation drifts back to rest once the camera is left alone.
      if (lookIdle > cfg.elevRelaxDelay) {
        elev += (cfg.elevDefault - elev) * Math.min(1, 1.5 * dt);
      }

      // Shorten the boom when the heightfield rises between the focus and
      // the eye; sample points along the segment at full length.
      placeEye();
      let desired = cfg.dist;
      const cosElev = Math.cos(elev);
      const dirX = -Math.sin(camYaw) * cosElev;
      const dirY = Math.sin(elev);
      const dirZ = -Math.cos(camYaw) * cosElev;
      for (let i = 1; i <= cfg.pullSamples; i++) {
        const t = i / (cfg.pullSamples + 1);
        const px = focus.x + dirX * cfg.dist * t;
        const py = focus.y + dirY * cfg.dist * t;
        const pz = focus.z + dirZ * cfg.dist * t;
        if (py < groundHeightAt(px, pz) + cfg.groundMargin) {
          desired = Math.max(cfg.minDist, cfg.dist * t * 0.85);
          break;
        }
      }
      const rate = desired < dist ? cfg.pullInRate : cfg.releaseRate;
      dist += (desired - dist) * Math.min(1, rate * dt);
      placeEye();

      camera.position.copy(eye);
      camera.lookAt(focus);
    },
  };
};
