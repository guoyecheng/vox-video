/**
 * 背景 = 一张摊在桌面上的旧地图/账页（MG-VOXSTAGE）。
 *
 * 三层材质缺一不可：做旧色层 + 旧地图纹 + 半调网点/纤维/格线。
 * 故意**没有**任何平涂区域——平涂在帧间完全一致，压缩器会把几十帧压成一帧，
 * 回放起来"死"，整片立刻退回 PPT。深色底只留给 quote。
 */

import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { FONT_BODY } from "../fonts";
import { useBeatPresence } from "./BeatPresence";
import { PAPER, STAGE_INFLATE, Tape, bandEdge, fiberStyle, hash01, jitter, roughEdge, sway } from "../paper";
import type { StageLayer } from "../timeline";
import { MapTexture } from "./MapTexture";

/** 底纸上的霉斑/水渍。位置写死，读作"这张纸放过很久"，不参与运动 */
const FOXING = [
  { x: 7, y: 16, r: 240, o: 0.075 },
  { x: 72, y: 10, r: 190, o: 0.05 },
  { x: 93, y: 64, r: 270, o: 0.085 },
  { x: 26, y: 90, r: 320, o: 0.09 },
  { x: 54, y: 46, r: 190, o: 0.045 },
];

/** 背景里的纸屑：不是装饰，是让"这一整幅是一张拼贴"成立的地基。
 *  只从画幅边缘**露出一角**——整块铺进来会变成大色块，跟内容抢注意力，
 *  第一版 46% 宽的纸屑直接把卡片压得看不见了。 */
const SCRAPS = [
  { left: -9, top: -7, w: 24, h: 18, rot: -12, tint: 0.07, seed: 3 },
  { left: 92, top: -6, w: 20, h: 15, rot: 9, tint: 0.05, seed: 8 },
  { left: -5, top: 92, w: 22, h: 16, rot: 6, tint: 0.45, seed: 15 },
];

/** 空气里的纸屑。位置/大小/速度/相位都由 seed 决定，渲染可复现 */
const MOTES = Array.from({ length: 34 }, (_, i) => ({
  x: hash01(i * 3.7 + 1),
  y: hash01(i * 9.1 + 2),
  s: 2 + hash01(i * 5.3 + 3) * 4.5,
  v: 0.008 + hash01(i * 7.7 + 4) * 0.022,
  ph: hash01(i * 11.3 + 5) * Math.PI * 2,
}));

export const PaperStage: React.FC<{
  accent: string;
  tone?: "paper" | "night";
  /** 本拍在全片中的起始帧。用来把漂移的相位接上，否则每拍都从相位 0 重新开始，切点会有跳变 */
  phaseOffset?: number;
  /** 配图层：`img/xxx.png`（相对 public/）。任意 kind 都能挂，内容照常压在图上 */
  image?: string;
  /** 配图的放置方式：full = 整幅压在纸下；inset = 像一张照片角贴在纸的右侧 */
  imageLayout?: "full" | "inset";
  /** 配图的纸浆覆盖强度，0-1。浅色拍默认 0.42、深色拍 0.55（inset 不用纸浆） */
  imageWash?: number;
  /** 分层背景板（远→近）。给了它就忽略 `image`：每层按 depth 走不同视差 */
  layers?: StageLayer[];
  children?: React.ReactNode;
}> = ({
  accent,
  tone = "paper",
  phaseOffset = 0,
  image,
  imageLayout = "full",
  imageWash,
  layers,
  children,
}) => {
  const frame = useCurrentFrame();
  const { presence } = useBeatPresence();

  const night = tone === "night";
  const bg = night ? COLORS.night : COLORS.stage;

  // 色块漂移：像窗光慢慢移过桌面。幅度必须够大才看得出——18px 全片看不出，
  // 帧间差也几乎不动；60px + 稍短的周期才读成"光在走"。
  // 用全片绝对帧算（frame 是 beat 内相对帧），连续切拍时背景才不会"抖一下"。
  const t = frame + phaseOffset;
  const dx = Math.sin(t / 150) * 58;
  const dy = Math.cos(t / 185) * 46;

  // 网格是"账册格线"：拼贴的底纸常常是账本/方格纸，也顺手给背景一点可读的尺度。
  // 别调到 0 以下——它在画面上是一层很细的高频边缘，调没了整片的帧间差会明显掉。
  const grid = interpolate(presence, [0, 1], [0, night ? 0.04 : 0.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const underlay: "layers" | "image" | null = layers?.length
    ? "layers"
    : image && imageLayout === "full"
      ? "image"
      : null;

  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily: FONT_BODY }}>
      {/* 整张底纸（纸屑 + 格线 + 纤维 + 内容）缓慢漂移。
          以前这里是**定格抖动**（每 2 帧跳 2.5px），单个纸片看着像定格动画，
          但整幅一起跳就变成"画面一直在抖"——大面积、多元素同时跳，眼睛读的是
          振动而不是手工感。现在改成两个低频正弦（240/300 帧周期）：
          位移连续、幅度 6px，读作"纸张在缓慢呼吸"。单个小标签想保留一点手工感，
          再单独用 `jitter()`。 */}
      <div
        style={{
          position: "absolute",
          inset: -STAGE_INFLATE,
          transform: `translate(${sway(t, 101, 6, 240).x}px, ${
            sway(t, 101, 6, 240).y
          }px) rotate(${sway(t, 202, 0.06, 300).x}deg)`,
        }}
      >
        {/* 纸屑：压在色块下面，只露出边角，读起来是"这张纸下面还垫着纸"。
            深色拍不放——浅色纸屑在夜里会变成一块发灰的方块，像渲染错误 */}
        {night
          ? null
          : SCRAPS.map((s, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${s.left + dx * (i + 1) * 0.06}%`,
              top: `${s.top - dy * (i + 1) * 0.06}%`,
              width: `${s.w}%`,
              height: `${s.h}%`,
              background: i === 2 ? PAPER.sheetWarm : accent,
              opacity: s.tint,
              borderRadius: 4,
              clipPath: roughEdge(s.seed, 5, 9),
              transform: `rotate(${s.rot}deg)`,
              boxShadow: `0 10px 24px ${PAPER.shade}`,
            }}
          />
        ))}

        <AbsoluteFill
          style={{
            background: `radial-gradient(1100px 760px at ${18 + dx}% ${22 + dy}%, ${accent}14 0%, transparent 68%),
                         radial-gradient(880px 700px at ${86 - dx}% ${82 - dy}%, ${accent}0D 0%, transparent 64%)`,
          }}
        />
        {/* 旧地图纹：这张底纸原本印的是什么。压在色斑上用 multiply 会触发
            合成层残留（PaperStage 祖先有 transform），所以只走普通 alpha。
            地图自己再漂 12px、转 0.2°：它和底纸不是同一层，视差让"镜头在纸上
            慢慢扫过"成立。幅度超过 20px 就会被读成地图在滑动，不是镜头在动。 */}
        <div
          style={{
            position: "absolute",
            inset: -40,
            transform: `translate(${sway(t, 503, 12, 160).x}px, ${
              sway(t, 503, 12, 160).y
            }px) rotate(${sway(t, 504, 0.2, 210).x}deg) scale(1.03)`,
          }}
        >
          <MapTexture night={night} opacity={night ? 0.2 : 0.52} />
        </div>
        {/* 半调网点：印刷品的身份证。网点缓慢爬移 5px/秒——像印张在机器上
            走了一点点，全画幅的高频边缘一直在变，静态拍也不会被压成一张图。
            幅度再大就会读成"画面在抖"：位移必须是像素级、低频。 */}
        <AbsoluteFill
          style={{
            backgroundImage: `radial-gradient(${
              night ? "rgba(246,239,221,0.55)" : "rgba(58,46,28,0.55)"
            } 0.8px, transparent 1px)`,
            backgroundSize: "5px 5px",
            backgroundPosition: `${((t * 0.16) % 5).toFixed(2)}px ${((t * 0.11) % 5).toFixed(2)}px`,
            opacity: night ? 0.05 : 0.14,
          }}
        />
        {/* 霉斑：几处极淡的暖棕水渍，越靠边越重 */}
        {night
          ? null
          : FOXING.map((f, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  width: f.r,
                  height: f.r * 0.78,
                  transform: "translate(-50%, -50%)",
                  background: `radial-gradient(closest-side, rgba(104,72,32,${
                    f.o * (0.6 + 0.4 * Math.sin(t / 210 + i))
                  }), transparent 72%)`,
                }}
              />
            ))}
        {/* 账册格线：比地图更弱，只当纸的经纬 */}
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${night ? "#ffffff" : COLORS.ink}22 1px, transparent 1px),
                              linear-gradient(90deg, ${night ? "#ffffff" : COLORS.ink}22 1px, transparent 1px)`,
            backgroundSize: "96px 96px",
            opacity: grid,
            // 格线跟着底纸一起极慢地平移；真正让它"活"起来的是外层定格位移——
            // 1px 的线每 2 帧挪 2.5px，边缘就在整幅上爬，这是纸面唯一的高频边缘。
            transform: `translate(${dx * 0.32}px, ${dy * 0.32}px) scale(1.04)`,
          }}
        />
        {/* 纸纤维。纤维只铺在浅色纸上，深色拍加颗粒会显脏 */}
        <AbsoluteFill style={{ ...fiberStyle, opacity: night ? 0.14 : 0.75 }} />
        {/* 配图层 · 整幅/分层版：压在纸下面的一张印刷品，被漂到只剩轮廓和明暗，
            文字才压得住。图跟着定格位移一起动，因为它和底纸是同一张纸上的东西。
            `inset` 版不用这一层——角贴的照片是一张实物，不该被纸浆洗白。
            `layers` 是同一层的高级形态：每层按 `depth` 走不同视差，读出景深。 */}
        {underlay === "layers" ? (
          <>
            {/* 底图（如果同时给了 image + full）：放在所有层之下当最远的一层 */}
            {image && imageLayout === "full" ? (
              <AbsoluteFill style={{ overflow: "hidden" }}>
                <Img
                  src={staticFile(image)}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${1.01 + 0.012 * Math.sin(t / 200)})`,
                    filter: "saturate(0.9) contrast(0.96) brightness(1.02)",
                  }}
                />
              </AbsoluteFill>
            ) : null}
            <AbsoluteFill style={{ overflow: "hidden" }}>
              {layers!.map((l, i) => {
                const n = layers!.length;
                const d = Math.min(1, Math.max(0, l.depth ?? (n > 1 ? i / (n - 1) : 0.5)));
                // 远景几乎不动、近景跟着纸走：位移系数 0.14 → 1.04
                const px = dx * (0.14 + 0.9 * d);
                const py = dy * (0.12 + 0.8 * d);
                // 每层各自一点点呼吸、相位错开，否则多层像一块板在平移
                const sc = 1.1 + 0.012 * Math.sin(t / 230 + i * 1.3);
                // band + y：这层只露出原图底部 band 那一条，并落在画面的 y 处。
                // 缩放是 1.1，原图底边要落在裁切带底边 → 下移 (y + band - 1.05) 个身高。
                const offY =
                  l.band != null && l.y != null ? (l.y + l.band - 1.05) * 100 : 0;
                const top = l.band != null ? (l.y != null ? l.y : 1 - l.band) * 100 : 0;
                return (
                  <AbsoluteFill
                    key={`${l.src}-${i}`}
                    style={l.band != null ? { clipPath: bandEdge(41 + i * 7, top, 100) } : undefined}
                  >
                    <Img
                      src={staticFile(l.src)}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: `translate(${px}px, ${py}px) translateY(${offY}%) scale(${sc})`,
                        filter: "saturate(0.92) contrast(0.97) brightness(1.02)",
                      }}
                    />
                  </AbsoluteFill>
                );
              })}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                background: night ? COLORS.night : COLORS.stage,
                opacity: imageWash ?? (night ? 0.55 : 0.26),
              }}
            />
            {/* 四周再压一圈纸色，越靠边越实：照片读成贴上去的，而不是显示器壁纸 */}
            <AbsoluteFill
              style={{
                background: `radial-gradient(125% 95% at 50% 46%, transparent 34%, ${
                  night ? COLORS.night : COLORS.stage
                }B0 100%)`,
              }}
            />
          </>
        ) : null}
        {underlay === "image" ? (
          <>
            <AbsoluteFill style={{ overflow: "hidden" }}>
              <Img
                src={staticFile(image!)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  // 极慢的呼吸式缩放：图本身是静态照片，靠 1.01-1.02 的推近
                  // 让它"活着"，比整幅抖动温和得多
                  transform: `scale(${1.01 + 0.012 * Math.sin(t / 200)})`,
                  filter: "saturate(0.9) contrast(0.96) brightness(1.02)",
                }}
              />
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                background: night ? COLORS.night : COLORS.stage,
                opacity: imageWash ?? (night ? 0.55 : 0.42),
              }}
            />
            {/* 四周再压一圈纸色，越靠边越实：照片读成贴上去的，而不是显示器壁纸 */}
            <AbsoluteFill
              style={{
                background: `radial-gradient(125% 95% at 50% 46%, transparent 34%, ${
                  night ? COLORS.night : COLORS.stage
                }B0 100%)`,
              }}
            />
          </>
        ) : null}
        {/* 配图层 · 角贴版：一张洗印好的照片，白边、压在纸角、用两段胶带粘住。
            放在内容层下面——卡片/路线可以压到它的边上，这本来就是剪贴簿的样子。 */}
        {image && imageLayout === "inset" ? (
          <div
            style={{
              position: "absolute",
              left: "52%",
              top: "25%",
              width: "41%",
              height: "47%",
              // 照片自己也在纸面上缓慢滑一点点：图是独立的一件东西，
              // 只跟着底纸走会看起来是"印上去的"
              transform: `rotate(-1.7deg) translate(${sway(t, 71, 3.2, 210).x}px, ${
                sway(t, 71, 3.2, 210).y
              }px)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                boxSizing: "border-box",
                background: PAPER.sheet,
                padding: 14,
                clipPath: roughEdge(21, 2.4, 8),
                filter: "drop-shadow(0 18px 26px rgba(46,34,18,0.26))",
              }}
            >
              <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
                <Img
                  src={staticFile(image)}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: "saturate(0.94) contrast(0.98)",
                  }}
                />
              </div>
            </div>
            <Tape seed={31} width={150} height={44} angle={-9} style={{ left: -46, top: -16 }} />
            <Tape seed={37} width={132} height={40} angle={7} style={{ right: -38, bottom: -12 }} />
          </div>
        ) : null}
        {children}
      </div>
      {/* 纸屑尘埃。它不是纹理，是**画面上唯一有独立运动的实物**：
          26 粒极小的纸屑在镜头前缓慢上浮、左右微摆、明暗起伏。
          之前靠"整幅抖动"制造"还在动"，那个代价是画面一直在颤；
          换成几粒慢速粒子，运动是真的、观感是静的。
          放在漂移层外面——尘埃在空气里，不跟着底纸走。 */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {MOTES.map((m, i) => {
          const yy = (((m.y * 120 - t * m.v - i * 4) % 120) + 120) % 120 - 10;
          const xx = m.x * 100 + Math.sin(t / 96 + m.ph) * 1.8;
          const o = 0.06 + 0.09 * (0.5 + 0.5 * Math.sin(t / 52 + m.ph));
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${xx}%`,
                top: `${yy}%`,
                width: m.s,
                height: m.s,
                borderRadius: "50%",
                background: night ? "rgba(255,248,232,0.95)" : "rgba(58,42,20,0.85)",
                opacity: o,
                filter: "blur(0.6px)",
              }}
            />
          );
        })}
      </AbsoluteFill>
      {/* 定格曝光的呼吸：每一格快门差一点点，整幅亮度在 0.4%-2.4% 之间游走。
          真实定格每拍一格，曝光不可能完全一致，这个量级（约 ±2 个灰阶）肉眼
          基本看不出，但它是整幅像素都在变——画面才不像"贴了一张图"。
          浅色底压黑、深色底提白：同样的 alpha 在 234 的纸上和 26 的夜里
          产生的灰阶差才一致。 */}
      <AbsoluteFill
        style={{
          background: night ? "#fff" : "#000",
          opacity: 0.012 + jitter(t, 404, 1, 3).x * 0.008,
          pointerEvents: "none",
        }}
      />
      {/* 边缘压暗留在最外层：它是柔渐变，跟着定格动会变成"画框在呼吸"，反而假。
          旧纸的四角本来就比中间深，这一圈也是"实物"的一部分 */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          boxShadow: night
            ? "inset 0 0 280px rgba(0,0,0,0.5)"
            : "inset 0 0 240px rgba(74,55,28,0.20)",
        }}
      />
    </AbsoluteFill>
  );
};
