// Adapted from rm-stacker (MIT, big-mesh-studios) — src/voxel-preview-material.ts.
// The same ray-marched voxel material, reworked for `InstancedMesh`.
//
// The preview's version assumes one mesh whose model matrix is the only
// transform the volume sits under. Here each of the ~1000 instances carries its
// own transform, so the material must derive its ray from the *instance's*
// inverse instead:
//
//  - The box geometry is the padded volume box in the volume's model space,
//    and the interpolated model-space position (`vModelPos`) is the point the
//    camera ray hits that box — exactly as in the preview.
//  - The camera, and the world-space light, are carried into the volume's
//    model space per instance in the vertex stage (`instanceMatrix⁻¹`, which
//    the default `NodeMaterial.buildVertexBody` also multiplies positions by).
//    Both values are constant across the box's eight corners, so their
//    interpolation is exact, and neither needs to reach the fragment stage as
//    a per-instance attribute (which WebGL2 vertex attributes cannot be).
//
// The preview wrote an accurate per-fragment depth so a picked-voxel outline
// could depth-test against the true voxel surface. This demo needs it for the
// same reason: a duck must occlude by its actual voxels, not by the front face
// of its bounding box. The obstacle is that the per-instance transform is a
// vertex attribute, which a WebGL2 fragment shader cannot read — so the vertex
// stage also passes the box-front clip z/w and the 3rd and 4th rows of
// projection·view·model·instance, and the fragment stage adds the rows' dot
// with the volume-space offset from the box entry to the hit to rebuild the
// hit's clip position (the transform is affine, so this is exact). Fragments
// that hit no voxel are pushed to the far plane so a duck's empty volume never
// occludes the ground or the ducks behind it.
//
// The InstancedMesh itself is expected to sit at the identity (position 0,
// no rotation, scale 1); all per-duck pose lives in `instanceMatrix`. Only the
// world-space light direction is fed in, so the transform it needs is just the
// inverse of the instance matrix.
//
// The material also works on a regular (non-instanced) `Mesh`, which may be
// positioned and rotated freely: there the volume→world transform is just the
// mesh's model matrix, so the vertex stage uses `modelMatrix⁻¹` for the
// camera/light and projection·view·model for the depth rows, and never
// touches `instanceMatrix` — referencing that attribute on a non-instanced
// draw would declare an unbound instanced attribute and break the draw call.

import type { Node, UniformNode } from "@random-mesh/rmsl";
import { builtinFragDepth, float, If, vec4 } from "@random-mesh/rmsl";
import type { Builder } from "@random-mesh/rmsl/scene";
import { DataTexture, NodeMaterial, Scene } from "@random-mesh/rmsl/scene";
import { marchVolume } from "./shaders-shared";

export class DuckMaterial extends NodeMaterial {
  voxelTexture: DataTexture;
  paletteTexture: DataTexture;
  dimensions: [number, number, number] = [0, 0, 0];
  voxelCount: [number, number, number] = [1, 1, 1];
  lightDir: [number, number, number] = [0, 0, 1];
  lightColour: [number, number, number] = [1, 1, 1];
  ambientColour: [number, number, number] = [0, 0, 0];
  unlit = false;

  private voxelsUniform?: UniformNode<"usampler3D">;
  private paletteUniform?: UniformNode<"sampler2D">;
  private dimensionsUniform?: UniformNode<"vec3">;
  private voxelCountUniform?: UniformNode<"vec3">;
  private lightDirUniform?: UniformNode<"vec3">;
  private lightColourUniform?: UniformNode<"vec3">;
  private ambientColourUniform?: UniformNode<"vec3">;
  private unlitUniform?: UniformNode<"bool">;

  constructor() {
    super();
    this.voxelTexture = new DataTexture(new Uint8Array(4), 1, 1, 1);
    this.paletteTexture = new DataTexture(new Uint8Array(4), 1, 1);
  }

  protected setup(b: Builder, _scene: Scene): void {
    this.voxelsUniform = b.sampler(
      "uVoxels",
      "usampler3D",
      () => this.voxelTexture,
    );
    this.paletteUniform = b.sampler(
      "uPalette",
      "sampler2D",
      () => this.paletteTexture,
    );
    this.dimensionsUniform = b.materialUniform(
      "uDimensions",
      "vec3",
      () => this.dimensions,
    );
    this.voxelCountUniform = b.materialUniform(
      "uVoxelCount",
      "vec3",
      () => this.voxelCount,
    );
    this.lightDirUniform = b.materialUniform(
      "uLightDir",
      "vec3",
      () => this.lightDir,
    );
    this.lightColourUniform = b.materialUniform(
      "uLightColour",
      "vec3",
      () => this.lightColour,
    );
    this.ambientColourUniform = b.materialUniform(
      "uAmbientColour",
      "vec3",
      () => this.ambientColour,
    );
    this.unlitUniform = b.materialUniform("uUnlit", "bool", () =>
      this.unlit ? 1 : 0,
    );
  }

  protected buildVertexBody(b: Builder): Node<"vec4"> {
    const position = b.position;
    // The vertex's model-space position, interpolated across the box, is the
    // point the ray from the camera hits the volume's bounding box.
    b.varying("vModelPos", "vec3").assign(position);

    // The transform that turns world vectors into the volume's model space:
    // `instanceMatrix⁻¹` when instanced (the mesh itself is assumed to sit at
    // the identity), or the plain mesh's `modelMatrix⁻¹` for a regular Mesh,
    // which may be positioned and rotated freely. It is the same for all
    // eight corners of one box, so carrying its two results through varyings
    // is exact.
    const toVolume = b.instancing
      ? b.instanceMatrix.inverse()
      : b.modelMatrix.inverse();
    b.varying("vCamVolume", "vec3").assign(
      toVolume.mul(vec4(b.cameraPosition, float(1))).xyz,
    );
    // The light is a direction, so its homogeneous coordinate is 0 and the
    // translation column of the inverse matrix does not reach it.
    b.varying("vLightVolume", "vec3").assign(
      toVolume.mul(vec4(this.lightDirUniform!, float(0))).xyz.normalize(),
    );

    const local = b.instancing
      ? b.instanceMatrix.mul(vec4(position, float(1)))
      : vec4(position, float(1));
    const clip = b.projectionMatrix.mul(
      b.viewMatrix.mul(b.modelMatrix.mul(local)),
    );

    // The box-front clip z/w at this fragment, plus the 3rd and 4th rows of
    // projection·view·(model·instance). The fragment stage uses them to rebuild
    // the clip position of the ray's true hit point (the instance matrix is a
    // vertex attribute, which a WebGL2 fragment shader cannot read). All three
    // are constant across a box, so their interpolation is exact. A regular
    // Mesh has no instance matrix, so its volume→clip transform is just
    // projection·view·model.
    b.varying("vClipZ", "float").assign(clip.z);
    b.varying("vClipW", "float").assign(clip.w);

    const mvw = b.instancing
      ? b.modelMatrix.mul(b.instanceMatrix)
      : b.modelMatrix;
    const full = b.projectionMatrix.mul(b.viewMatrix.mul(mvw));
    b.varying("vRow2", "vec4").assign(
      vec4(
        full.element(0).element(2),
        full.element(1).element(2),
        full.element(2).element(2),
        full.element(3).element(2),
      ),
    );
    b.varying("vRow3", "vec4").assign(
      vec4(
        full.element(0).element(3),
        full.element(1).element(3),
        full.element(2).element(3),
        full.element(3).element(3),
      ),
    );

    return clip;
  }

  protected buildFragmentBody(b: Builder): Node<"vec4"> {
    // The camera position, transformed into the volume's model space by the
    // vertex stage, is where each duck's rays start; vModelPos is the box
    // point the ray from the camera lands on, which gives its direction.
    const rayOrigin = b.varying("vCamVolume", "vec3");
    const rayDirection = b
      .varying("vModelPos", "vec3")
      .sub(rayOrigin)
      .normalize();
    const { colour, hitPoint } = marchVolume({
      rayOrigin,
      rayDirection,
      voxels: this.voxelsUniform!,
      palette: this.paletteUniform!,
      dimensions: this.dimensionsUniform!,
      voxelCount: this.voxelCountUniform!,
      lightDir: b.varying("vLightVolume", "vec3"),
      lightColour: this.lightColourUniform!,
      ambientColour: this.ambientColourUniform!,
      unlit: this.unlitUniform!,
    });

    const fragDepth = builtinFragDepth();
    If(colour.a.greaterThan(float(0.5)), () => {
      // Write the depth of the true voxel surface, so ducks occlude each other
      // by their geometry. The vertex stage passed the box-entry clip z/w and
      // the rows of projection·view·model·instance; adding the rows' dot with
      // the volume-space offset from the box entry to the hit rebuilds the
      // hit's clip position.
      const d = hitPoint.sub(b.varying("vModelPos", "vec3"));
      const clipZ = b
        .varying("vClipZ", "float")
        .add(b.varying("vRow2", "vec4").dot(vec4(d, float(0))));
      const clipW = b
        .varying("vClipW", "float")
        .add(b.varying("vRow3", "vec4").dot(vec4(d, float(0))));
      fragDepth.assign(clipZ.div(clipW).mul(float(0.5)).add(float(0.5)));
    }).Else(() => {
      // A fragment that hits no voxel is transparent; push it to the far plane
      // so it never occludes the ground or a duck behind it.
      fragDepth.assign(float(1));
    });

    return colour;
  }
}
