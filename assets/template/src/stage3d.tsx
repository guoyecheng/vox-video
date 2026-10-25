/**
 * 纸艺拼贴的 3D 舞台（可选层）。
 *
 * 把 2D 靠视差模拟的"纸片叠层"换成真的 Z 轴，让运镜产生前后位移。
 * 排版仍然留给 DOM（中文字形和可读性在 3D 里没有胜算），这里只出底纸、
 * 纸片、胶带和空气里的尘埃。在 script.json 的 `visual.stage3d` 里启用。
 *
 * 所有动画都由 useCurrentFrame 推导，不读挂钟时间：
 * Remotion 是多实例并行逐帧截图，任何 performance.now / useFrame delta
 * 都会让同一帧在不同 worker 上长得不一样。
 */

import React, { useLayoutEffect, useMemo } from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type {
  Beat,
  Stage3DCamera,
  Stage3DMarkSpec,
  Stage3DPieceSpec,
  Stage3DSpec,
  Stage3DTapeSpec,
} from "./timeline";
import { resolveWordTimings } from "./words";

export type CameraKind = Stage3DCamera;
export type { Stage3DMarkSpec, Stage3DPieceSpec, Stage3DSpec, Stage3DTapeSpec };

/* ---------------- 解析后的运行时结构 ---------------- */

export type ResolvedPiece = {
  src: string;
  x: number;
  y: number;
  z: number;
  w: number;
  rot?: number;
  spin?: number;
  enter?: "drop" | "rise" | "pop" | "none";
  at?: number;
  shadow?: number;
  wash?: number;
  gray?: number;
  hole?: number;
  spinAt?: number;
  spinDur?: number;
  fallAt?: number;
  fall?: number;
  drift?: number;
  blend?: "normal" | "multiply";
  alphaCut?: number;
  marks?: ResolvedMark[];
};

export type ResolvedMark = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rot: number;
  color: string;
  drawAt?: number;
  drawDur?: number;
};

export type ResolvedTape = Stage3DTapeSpec;

export type ResolvedStage3D = {
  camera: CameraKind;
  pieces: ResolvedPiece[];
  tapes: ResolvedTape[];
  foreground?: boolean;
  motes?: boolean;
  backdrop?: number;
  punch?: number;
  sway?: number;
  mapSrc?: string;
};

/**
 * 词级锚点 → 拍内帧。和 2D cutouts 共用 resolveWordTimings：
 * 旁白按 boundary 切词，"井盖"可能被切成"井"+"盖"，规则只该有一份。
 * 命中后提前 2 帧起手；锚点不在旁白里时按拍长均匀铺开（同 2D 语义）。
 */
const wordFrame = (beat: Beat, anchor?: string) => {
  if (!anchor) return undefined;
  const hit = resolveWordTimings([anchor], beat.words, beat.durationInFrames)[0];
  return hit ? Math.max(0, hit.t - 2) : undefined;
};

const cameraKind = (c?: string): CameraKind =>
  c === "pull_out" || c === "pan" || c === "static" ? c : "push_in";

export const resolveStage3D = (beat: Beat, spec: Stage3DSpec): ResolvedStage3D => ({
  camera: spec.camera ?? cameraKind(beat.visual.camera),
  punch: spec.punch,
  backdrop: spec.backdrop,
  foreground: spec.foreground,
  motes: spec.motes,
  sway: spec.sway,
  mapSrc: spec.mapSrc,
  tapes: spec.tapes ?? [],
  pieces: spec.pieces.map((p) => ({
    src: p.src,
    x: p.x,
    y: p.y,
    z: p.z ?? 0,
    w: p.w,
    rot: p.rot,
    shadow: p.shadow,
    drift: p.drift,
    wash: p.wash,
    gray: p.gray,
    hole: p.hole,
    alphaCut: p.alphaCut,
    blend: p.blend,
    enter: p.enter ?? "none",
    at: wordFrame(beat, p.at),
    spin: p.spin,
    spinAt: wordFrame(beat, p.spinAt),
    spinDur: p.spinDur,
    fallAt: wordFrame(beat, p.fall),
    fall: p.fallDistance,
    marks: p.marks?.map((m) => ({
      x: m.x ?? 0,
      y: m.y ?? 0,
      z: m.z ?? 0.03,
      w: m.w,
      h: m.h ?? 0.03,
      rot: m.rot ?? 0,
      color: m.color ?? "#D62E1F",
      drawAt: wordFrame(beat, m.at),
      drawDur: m.drawDur,
    })),
  })),
});

/* ---------------- GLSL ---------------- */

const NOISE = `
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

const BACKDROP_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BACKDROP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uProgress;
uniform float uSeed;
uniform float uAspect;
uniform float uLevel;
${NOISE}
void main(){
  vec2 q = vUv * vec2(uAspect, 1.0);

  float stain = fbm(q * 2.2 + uSeed * 13.0);
  vec3 col = uPaper * (0.90 + 0.14 * stain);

  // 纸纤维：横向拉长的细噪声，比均匀颗粒更像纸
  float fiber = fbm(vec2(q.x * 130.0, q.y * 26.0));
  col *= 0.96 + 0.07 * fiber;

  // 半调网点
  vec2 g = q * 170.0;
  float dots = 1.0 - smoothstep(0.085, 0.135, length(fract(g) - 0.5));
  col = mix(col, col * 0.90, dots * 0.22);

  // 账册格线
  vec2 gl = abs(fract(q * vec2(13.0, 8.0)) - 0.5);
  float grid = smoothstep(0.482, 0.5, max(gl.x, gl.y));
  col = mix(col, uInk, grid * 0.07);

  // 霉斑：只做很轻的色差，做重了会变成一颗颗圆斑
  float fox = smoothstep(0.70, 0.95, fbm(q * 3.0 + 7.3));
  col = mix(col, uPaper * 0.86, fox * 0.10);

  // 光带：位置只由 uProgress 决定，同帧必然同像素
  float band = smoothstep(0.0, 0.42, 1.0 - abs((q.x * 0.7 + q.y * 0.3) - (uProgress * 1.9 - 0.45)));
  col += vec3(0.075, 0.064, 0.042) * band;

  vec2 v = vUv - 0.5;
  float vig = smoothstep(0.88, 0.22, length(v * vec2(1.0, 0.86)));
  col *= 0.80 + 0.20 * vig;

  gl_FragColor = vec4(col * uLevel, 1.0);
  #include <colorspace_fragment>
}
`;

const PIECE_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PIECE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uMap;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uSeed;
uniform float uOpacity;
uniform float uWash;
uniform float uGray;
uniform float uHole;
uniform float uMultiply;
uniform float uCut;
${NOISE}
void main(){
  vec4 t = texture2D(uMap, vUv);
  if (t.a < uCut) {
    if (uMultiply > 0.5) {
      // multiply 混合下，透明区就是"不改变背景"
      gl_FragColor = vec4(1.0);
      return;
    }
    discard;
  }

  // 用纹理原亮度判断"哪里是深色实体"：白纸边不压暗，洞底才压暗
  float lt = dot(t.rgb, vec3(0.299, 0.587, 0.114));

  float f = fbm(vUv * vec2(90.0, 70.0) + uSeed);
  vec3 col = t.rgb * (0.93 + 0.09 * f);
  col = mix(col, uPaper, uWash);
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uGray);

  // 左上受光、右下压暗，纸片才有厚度
  float shade = 0.88 + 0.12 * (1.0 - vUv.y) + 0.05 * (1.0 - vUv.x);
  col *= shade;

  // 洞：只吃接近纯黑的区域。阈值放宽会把洞边的烘焙投影一起压黑，
  // 变成一坨洗不掉的灰泥。
  float holeMask = smoothstep(0.42, 0.12, lt);
  col = mix(col, uInk, uHole * holeMask);

  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}
`;

const SHADOW_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uMap;
uniform float uShadow;
uniform float uCut;
void main(){
  if (texture2D(uMap, vUv).a < uCut) discard;
  // 边缘收一点，硬边投影会露出"贴纸"的机械感
  vec2 d = abs(vUv - 0.5) * 2.0;
  float soft = 1.0 - smoothstep(0.62, 1.0, max(d.x, d.y));
  gl_FragColor = vec4(0.055, 0.048, 0.040, 0.13 * uShadow * soft);
  #include <colorspace_fragment>
}
`;

const TAPE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec3 uTint;
uniform float uSeed;
${NOISE}
void main(){
  // 胶带两头是撕的，不是裁的
  float tear = fbm(vec2(vUv.y * 16.0 + uSeed, uSeed)) * 0.055;
  if (vUv.x < tear || vUv.x > 1.0 - tear) discard;

  float f = fbm(vUv * vec2(70.0, 22.0) + uSeed);
  vec3 col = uTint * (0.94 + 0.10 * f);
  float seam = smoothstep(0.0, 0.09, vUv.x) * smoothstep(0.0, 0.09, 1.0 - vUv.x);
  gl_FragColor = vec4(col, (0.48 + 0.10 * f) * (0.84 + 0.16 * seam));
  #include <colorspace_fragment>
}
`;

const TORN_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec3 uPaper;
uniform float uSeed;
${NOISE}
void main(){
  float n = fbm(vec2(vUv.x * 10.0 + uSeed, vUv.y * 6.0));
  float edge = 0.56 + (n - 0.5) * 0.30;
  if (vUv.y > edge) discard;

  vec3 col = uPaper * (0.93 + 0.11 * n);
  float fiber = fbm(vec2(vUv.x * 170.0, vUv.y * 18.0));
  col *= 0.96 + 0.06 * fiber;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const MOTE_VERT = `
uniform float uFrame;
attribute float aSize;
attribute float aPhase;
varying float vA;
void main(){
  vec3 p = position;
  float rise = fract(aPhase + uFrame * 0.0022);
  p.y += rise * 1.4 - 0.7;
  p.x += sin(uFrame * 0.018 + aPhase * 6.283) * 0.06;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * (13.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
  vA = 0.10 + 0.16 * aPhase;
}
`;

const MOTE_FRAG = `
precision highp float;
varying float vA;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  if (length(d) > 0.5) discard;
  gl_FragColor = vec4(0.10, 0.085, 0.065, vA);
}
`;

/* ---------------- camera ---------------- */

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth01 = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

type Pose = { pos: [number, number, number]; target: [number, number, number]; fov: number };

const cameraPose = (
  kind: CameraKind,
  frame: number,
  duration: number,
  punch = 0,
  sway = 1,
): Pose => {
  const raw = Math.min(1, Math.max(0, frame / Math.max(1, duration)));
  // easeOut 会把运镜全堆在开头，后半拍静止 → PPT 感。余弦缓动让整拍匀速走完。
  const p = 0.5 - 0.5 * Math.cos(Math.PI * raw);
  const kick =
    frame < 2 ? frame / 2 : Math.exp(-(frame - 2) / 7);
  const base = (() => {
    switch (kind) {
      case "push_in":
        return {
          pos: [lerp(-1.15, -0.15, p), lerp(0.12, -0.06, p), lerp(7.8, 6.0, p)] as [number, number, number],
          target: [lerp(0.25, 0.85, p), 0.02, 0] as [number, number, number],
          fov: 34,
        };
      case "pull_out":
        return {
          pos: [lerp(0.55, 1.15, p), lerp(-0.08, 0.14, p), lerp(5.5, 7.1, p)] as [number, number, number],
          target: [0.85, 0.05, 0] as [number, number, number],
          fov: 34,
        };
      case "pan":
        return {
          pos: [lerp(-1.5, 1.5, p), 0.10, 6.15] as [number, number, number],
          target: [lerp(-0.2, 1.5, p), 0.0, 0] as [number, number, number],
          fov: 34,
        };
      default:
        return {
          pos: [0, 0, 6.2] as [number, number, number],
          target: [0.5, 0, 0] as [number, number, number],
          fov: 34,
        };
    }
  })();
  if (punch > 0) {
    base.pos[2] -= punch * kick;
    base.fov -= 0.9 * punch * kick;
  }
  if (sway > 0) {
    // 手持感：三组不同周期的低频漂移，帧间差很小但整拍一直在走
    base.pos[0] += Math.sin(frame / 66) * 0.045 * sway;
    base.pos[1] += Math.cos(frame / 88) * 0.028 * sway;
    base.target[0] += Math.sin(frame / 72 + 0.7) * 0.03 * sway;
    base.target[1] += Math.cos(frame / 97 + 1.3) * 0.02 * sway;
  }
  return base;
};

const CameraRig: React.FC<{ pose: Pose }> = ({ pose }) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const [px, py, pz] = pose.pos;
  const [tx, ty, tz] = pose.target;
  useLayoutEffect(() => {
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }, [camera, px, py, pz, tx, ty, tz, pose.fov]);
  return null;
};

/* ---------------- pieces ---------------- */

const PaperPiece: React.FC<{ piece: ResolvedPiece; frame: number; duration: number; seed: number }> = ({
  piece,
  frame,
  duration,
  seed,
}) => {
  const texture = useLoader(THREE.TextureLoader, staticFile(piece.src));
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }, [texture]);

  const image = texture.image as { width: number; height: number };
  const aspect = image?.width && image?.height ? image.width / image.height : 1;
  const w = piece.w;
  const h = w / aspect;

  const enter = piece.enter ?? "none";
  const at = piece.at ?? 0;
  const ep = Math.min(1, Math.max(0, (frame - at) / 11));
  const eased = easeOut(ep);

  let yOffset = 0;
  let xOffset = 0;
  let scale = 1;
  let opacity = 1;
  if (enter === "drop") {
    yOffset = (1 - eased) * 1.5;
  } else if (enter === "rise") {
    yOffset = -(1 - eased) * 0.9;
  } else if (enter === "pop") {
    scale = 0.72 + eased * 0.28;
  }

  // 掉进洞里：加速下坠 + 缩小 + 快速淡出，动作锚在"掉进"这个词上
  let fallE = 0;
  if (piece.fallAt != null) {
    const fp = clamp01((frame - piece.fallAt) / 26);
    fallE = fp * fp;
    yOffset -= (piece.fall ?? 1.35) * fallE;
    scale *= 1 - 0.55 * fallE;
    opacity *= 1 - smooth01((fp - 0.32) / 0.68);
  }

  // 旋转可以整拍匀速，也可以等念到某个词再转
  const spinP =
    piece.spinAt != null
      ? easeOut(clamp01((frame - piece.spinAt) / (piece.spinDur ?? 24)))
      : clamp01(frame / Math.max(1, duration));
  const spin = (piece.spin ?? 0) * spinP + 24 * fallE;

  // 纸片不是钉死的：不同种子的低频微漂移，让静止段也有呼吸
  const drift = piece.drift ?? 0.018;
  const swayX = Math.sin(frame / 54 + seed * 2.3) * drift;
  const swayY = Math.cos(frame / 71 + seed * 1.7) * drift * 0.65;

  const rotZ = THREE.MathUtils.degToRad((piece.rot ?? 0) + spin);
  const shadow = piece.shadow ?? 0;

  // 逐帧值必须作为新对象传进去。R3F 的 shaderMaterial 只在 uniforms 引用变化时
  // 同步到材质；直接改 uniforms.xxx.value，在逐帧渲染的视频管线里会停在挂载那一帧，
  // 只有单帧截图（still）碰巧正确。
  const baseUniforms = useMemo(
    () => ({
      uMap: { value: texture },
      uPaper: { value: new THREE.Color("#F6EFDD") },
      uInk: { value: new THREE.Color("#17120E") },
      uSeed: { value: seed * 0.37 + 0.11 },
      uWash: { value: piece.wash ?? 0.04 },
      uGray: { value: piece.gray ?? 0 },
      uHole: { value: piece.hole ?? 0 },
      uMultiply: { value: piece.blend === "multiply" ? 1 : 0 },
      uCut: { value: piece.alphaCut ?? 0.35 },
    }),
    [texture, seed, piece.wash, piece.gray, piece.hole, piece.blend, piece.alphaCut],
  );
  const uniforms = { ...baseUniforms, uOpacity: { value: opacity } };

  const shadowBase = useMemo(
    () => ({
      uMap: { value: texture },
      uCut: { value: piece.alphaCut ?? 0.35 },
    }),
    [texture, piece.alphaCut],
  );
  const shadowUniforms = { ...shadowBase, uShadow: { value: clamp01(1 - fallE * 3) } };

  return (
    <group
      position={[piece.x + xOffset + swayX, piece.y + yOffset + swayY, piece.z]}
      rotation={[0, 0, rotZ]}
      scale={[scale, scale, 1]}
    >
      {shadow > 0 ? (
        <mesh position={[shadow * 0.45, -shadow, -0.012]}>
          <planeGeometry args={[w, h]} />
          <shaderMaterial
            uniforms={shadowUniforms}
            vertexShader={PIECE_VERT}
            fragmentShader={SHADOW_FRAG}
            transparent
            depthWrite={false}
          />
        </mesh>
      ) : null}
      <mesh>
        <planeGeometry args={[w, h]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={PIECE_VERT}
          fragmentShader={PIECE_FRAG}
          transparent
          blending={piece.blend === "multiply" ? THREE.MultiplyBlending : THREE.NormalBlending}
        />
      </mesh>
      {(piece.marks ?? []).map((bar, i) => (
        <RedMark key={`mark-${i}`} bar={bar} frame={frame} />
      ))}
    </group>
  );
};

/* ---------------- marks / tape ---------------- */

/** 红笔线：从一端画出来，末端带一个笔尖落点 */
const RedMark: React.FC<{ bar: ResolvedMark; frame: number }> = ({ bar, frame }) => {
  const p =
    bar.drawAt == null
      ? 1
      : easeOut(clamp01((frame - bar.drawAt) / (bar.drawDur ?? 10)));
  const rot = THREE.MathUtils.degToRad(bar.rot);
  const dx = Math.cos(rot);
  const dy = Math.sin(rot);
  const len = Math.max(0.001, bar.w * p);
  // 起点固定，往另一端长
  const x0 = bar.x - dx * bar.w * 0.5;
  const y0 = bar.y - dy * bar.w * 0.5;

  return (
    <group>
      <mesh position={[x0 + dx * len * 0.5, y0 + dy * len * 0.5, bar.z]} rotation={[0, 0, rot]}>
        <planeGeometry args={[len, bar.h]} />
        <meshBasicMaterial color={bar.color} transparent opacity={0.93} />
      </mesh>
      {p > 0.82 ? (
        <mesh position={[x0 + dx * len, y0 + dy * len, bar.z + 0.001]}>
          <circleGeometry args={[bar.h * 1.25, 20]} />
          <meshBasicMaterial
            color={bar.color}
            transparent
            opacity={0.93 * clamp01((p - 0.82) / 0.12)}
          />
        </mesh>
      ) : null}
    </group>
  );
};

const Tape: React.FC<{ tape: ResolvedTape; seed: number }> = ({ tape, seed }) => {
  const uniforms = useMemo(
    () => ({
      uTint: { value: new THREE.Color("#E2CF9E") },
      uSeed: { value: seed * 0.71 + 0.23 },
    }),
    [seed],
  );
  return (
    <mesh
      position={[tape.x, tape.y, tape.z]}
      rotation={[0, 0, THREE.MathUtils.degToRad(tape.rot)]}
    >
      <planeGeometry args={[tape.w, tape.h]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={PIECE_VERT}
        fragmentShader={TAPE_FRAG}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
};

/* ---------------- motes ---------------- */

const hash01 = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const Motes: React.FC<{ frame: number }> = ({ frame }) => {
  const geometry = useMemo(() => {
    const count = 56;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (hash01(i * 3.1 + 1) - 0.5) * 7.5;
      positions[i * 3 + 1] = (hash01(i * 7.7 + 2) - 0.5) * 3.4;
      positions[i * 3 + 2] = hash01(i * 5.3 + 3) * 2.2 - 0.9;
      sizes[i] = 1.4 + hash01(i * 9.1 + 4) * 2.6;
      phases[i] = hash01(i * 11.3 + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return g;
  }, []);

  const uniforms = { uFrame: { value: frame } };

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={MOTE_VERT}
        fragmentShader={MOTE_FRAG}
        transparent
        depthWrite={false}
      />
    </points>
  );
};

/* ---------------- scene ---------------- */

const Backdrop: React.FC<{ progress: number; seed: number; level: number }> = ({
  progress,
  seed,
  level,
}) => {
  const { width, height } = useVideoConfig();
  const base = useMemo(
    () => ({
      uPaper: { value: new THREE.Color("#D3C2A4") },
      uInk: { value: new THREE.Color("#1A1A1A") },
      uSeed: { value: seed },
      uAspect: { value: width / height },
      uLevel: { value: level },
    }),
    [width, height, seed, level],
  );
  const uniforms = { ...base, uProgress: { value: progress } };

  return (
    <mesh position={[0, 0, -3]}>
      <planeGeometry args={[22, 12]} />
      <shaderMaterial uniforms={uniforms} vertexShader={BACKDROP_VERT} fragmentShader={BACKDROP_FRAG} />
    </mesh>
  );
};

const TornStrip: React.FC<{ seed: number; progress: number; frame: number }> = ({
  seed,
  progress,
  frame,
}) => {
  const uniforms = useMemo(
    () => ({
      uPaper: { value: new THREE.Color("#E7DAC1") },
      uSeed: { value: seed },
    }),
    [seed],
  );

  return (
    <mesh
      position={[
        0.2 + (progress - 0.5) * 0.95 + Math.sin(frame / 78) * 0.055,
        -1.45 + Math.cos(frame / 104) * 0.03,
        1.5,
      ]}
      rotation={[0, 0, THREE.MathUtils.degToRad(-0.8 + Math.sin(frame / 122) * 0.45)]}
    >
      <planeGeometry args={[7.4, 3.2]} />
      <shaderMaterial uniforms={uniforms} vertexShader={PIECE_VERT} fragmentShader={TORN_FRAG} />
    </mesh>
  );
};

const MapSheet: React.FC<{ src: string }> = ({ src }) => {
  const texture = useLoader(THREE.TextureLoader, staticFile(src));
  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
  }, [texture]);
  return (
    <mesh position={[0, 0, -2.98]}>
      <planeGeometry args={[16, 9]} />
      <meshBasicMaterial map={texture} transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
};

const Scene: React.FC<{ scene: ResolvedStage3D; duration: number }> = ({ scene, duration }) => {
  const frame = useCurrentFrame();
  const pose = cameraPose(scene.camera, frame, duration, scene.punch ?? 0, scene.sway ?? 1);
  const progress = Math.min(1, Math.max(0, frame / Math.max(1, duration)));

  return (
    <>
      <CameraRig pose={pose} />

      {/* 底纸和地图一起慢慢漂：镜头推拉之外还有一层"纸在呼吸"的低频运动 */}
      <group
        position={[
          Math.sin(frame / 95) * 0.16,
          Math.cos(frame / 130) * 0.09,
          0,
        ]}
      >
        <Backdrop progress={progress} seed={0.63} level={scene.backdrop ?? 1} />
        {scene.mapSrc ? <MapSheet src={scene.mapSrc} /> : null}
      </group>

      {scene.pieces.map((piece, i) => (
        <PaperPiece key={i} piece={piece} frame={frame} duration={duration} seed={i + 1} />
      ))}

      {scene.tapes.map((tape, i) => (
        <Tape key={`tape-${i}`} tape={tape} seed={i + 3} />
      ))}

      {scene.foreground ? <TornStrip seed={0.31} progress={progress} frame={frame} /> : null}
      {scene.motes !== false ? <Motes frame={frame} /> : null}
    </>
  );
};

/**
 * 一拍 3D 舞台。放在内容层下面；DOM 排版照常压在上面。
 * 运镜在 3D 里完成，外层不要再套 2D 的 camera transform。
 */
export const Stage3D: React.FC<{ beat: Beat; spec: Stage3DSpec }> = ({ beat, spec }) => {
  const { width, height } = useVideoConfig();
  const scene = useMemo(() => resolveStage3D(beat, spec), [beat, spec]);
  return (
    <AbsoluteFill>
      <ThreeCanvas
        width={width}
        height={height}
        dpr={1}
        camera={{ fov: 34, position: [0, 0, 6.4], near: 0.1, far: 60 }}
        gl={{ antialias: true, alpha: false }}
        style={{ position: "absolute", inset: 0, width, height }}
      >
        <Scene scene={scene} duration={beat.durationInFrames} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
