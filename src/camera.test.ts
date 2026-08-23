import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAMERA_CFG, createOotCamera, type OotCamera } from "./camera";
import type { InputSnapshot, Player } from "@big-mesh-studios/bms-voxelscape";
import { Vector3, type PerspectiveCamera } from "@random-mesh/rmsl/scene";

// camera.ts only reads PLAYER_CFG.lookSensitivity; isolate it from the
// rest of the voxelscape bundle, which expects a browser.
vi.mock("@big-mesh-studios/bms-voxelscape", () => ({
  PLAYER_CFG: { lookSensitivity: 0.005 },
}));

const flatGround = () => 0;

const makePlayer = (yaw = 0, y = 1): Player => ({
  position: new Vector3(0, y, 0),
  yaw,
  pitch: 0,
  vy: 0,
  onGround: true,
});

const stubCamera = () =>
  ({
    position: new Vector3(),
    lookAt: () => {},
  }) as unknown as PerspectiveCamera;

const noInput = (): InputSnapshot => ({
  moveX: 0,
  moveY: 0,
  jump: false,
  jumpHeld: false,
  lookDx: 0,
  lookDy: 0,
});

/**
 * One frame of the normal game-loop ordering. Like `consumeInput`, each
 * frame gets a FRESH snapshot — `applyControls` rewrites the stick in
 * place, so reusing one object would compound the transform.
 */
const runFrames = (
  cam: OotCamera,
  player: Player,
  camera: PerspectiveCamera,
  dt: number,
  makeInput: () => InputSnapshot,
): InputSnapshot[] => {
  const seen: InputSnapshot[] = [];
  const steps = Math.ceil(6 / dt);
  for (let i = 0; i < steps; i++) {
    const input = makeInput();
    cam.applyControls(player, dt, input);
    cam.update(camera, player, dt);
    seen.push(input);
  }
  return seen;
};

describe("OoT camera controls", () => {
  let camera: PerspectiveCamera;
  beforeEach(() => {
    camera = stubCamera();
  });

  it("leaves an aligned stick untouched", () => {
    const cam = createOotCamera(flatGround);
    const player = makePlayer(0);
    cam.snap(camera, player);
    const [input] = runFrames(cam, player, camera, 1 / 60, () => ({
      ...noInput(),
      moveY: 1,
    }));
    expect(player.yaw).toBeCloseTo(0);
    expect(input.moveY).toBeCloseTo(1);
    expect(input.moveX).toBeCloseTo(0, 6);
  });

  it("moves the character camera-relative and auto-turns toward the stick", () => {
    const cam = createOotCamera(flatGround);
    const player = makePlayer(0);
    cam.snap(camera, player);
    // Character has turned away (facing +X) while the camera stayed at
    // yaw 0; holding "up" on the stick must head down +Z (away from the
    // camera) and swing the character back toward yaw 0.
    player.yaw = Math.PI / 2;
    const seen = runFrames(cam, player, camera, 1 / 60, () => ({
      ...noInput(),
      moveY: 1,
    }));
    const input = seen[seen.length - 1];
    // Turn done (~pi/2 at 7 rad/s takes ~13 frames): heading realigned
    // with the camera, so the rewritten stick is pure forward again...
    expect(player.yaw).toBeCloseTo(0, 6);
    expect(input.moveY).toBeCloseTo(1, 5);
    expect(input.moveX).toBeCloseTo(0, 5);
    // ...and the world motion the package will produce points along the
    // camera forward (+Z).
    const vx =
      input.moveY * Math.sin(player.yaw) - input.moveX * Math.cos(player.yaw);
    const vz =
      input.moveY * Math.cos(player.yaw) + input.moveX * Math.sin(player.yaw);
    expect(vz).toBeGreaterThan(0.999);
    expect(Math.abs(vx)).toBeLessThan(0.001);
  });

  it("swings behind the character while they stand still", () => {
    const cam = createOotCamera(flatGround);
    const player = makePlayer(0);
    cam.snap(camera, player);
    player.yaw = Math.PI;
    runFrames(cam, player, camera, 1 / 60, noInput);
    // Facing -Z, so "behind" is the +Z side; the eye must end up there.
    expect(camera.position.z - player.position.z).toBeGreaterThan(6);
  });

  it("does not fight the player while they hold a look-drag", () => {
    const cam = createOotCamera(flatGround);
    const player = makePlayer(Math.PI); // camera starts opposite-facing
    cam.snap(camera, player);
    const before = camera.position.clone();
    const input = noInput();
    input.lookDx = 1; // any nonzero delta keeps the timer reset
    cam.applyControls(player, 1 / 60, input);
    cam.update(camera, player, 1 / 60);
    // Only the drag itself moves the orbit this frame; the recenter
    // spring must stay off (an active spring would swing ~capIdle*dt).
    expect(camera.position.distanceTo(before)).toBeLessThan(0.5);
  });

  it("shortens the boom when terrain rises between focus and eye", () => {
    // A plateau blocking anything beyond 5 units on the camera side (-Z).
    const cam = createOotCamera((_x, z) => (z < -5 ? 10 : 0));
    const player = makePlayer(0);
    cam.snap(camera, player);
    runFrames(cam, player, camera, 1 / 60, noInput);
    // Unblocked would sit near z = -dist; pulled-in stays well short.
    expect(camera.position.z).toBeGreaterThan(-7.5);
  });
});
