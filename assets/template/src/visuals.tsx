/**
 * visual.kind → 组件的注册表。
 *
 * 要加新组件，在这里加一行就够了，不用改 VoxVideo。
 * 组件签名统一是 ({beat, visual, accent})，beat 里带着词级时间戳，
 * 所以任何组件都能做到"动画卡在旁白上"而不需要额外接线。
 *
 * 这一层同时负责给每一拍套上特效层（冲击 / 闪白 / 光带），
 * 所以单个组件不需要关心这些——它们是全片通用的装饰，不是某一拍的属性。
 */

import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import type { FC } from "react";
import { ACCENT_CYCLE } from "./theme";
import type { Beat, VisualKind, VisualSpec } from "./timeline";
import type { Shot } from "./shots";
import { SHOT_FADE } from "./shots";
import { ShotLayer } from "./ShotLayer";
import {
  Callout,
  CardStack,
  Chart,
  CompareSplit,
  CutoutLayer,
  Highlight,
  ImageCard,
  KineticText,
  NoteLayer,
  Odometer,
  PaperStage,
  Person,
  PieceLayer,
  QuoteCard,
  Route,
  RunningHead,
  Split,
  Stack,
  StatCard,
  TimelineRail,
  useStage,
} from "./components";
import { AmbientLight, Confetti, Flash, LightSweep, Starburst, useAmbient, useCamera } from "./effects";

export type VisualProps = {
  beat: Beat;
  visual: VisualSpec;
  accent: string;
  tone?: "paper" | "night";
};

const REGISTRY: Record<VisualKind, FC<VisualProps>> = {
  kinetic: KineticText,
  stat: StatCard,
  odometer: Odometer,
  quote: QuoteCard,
  highlight: Highlight,
  compare: CompareSplit,
  split: Split,
  timeline: TimelineRail,
  cards: CardStack,
  stack: Stack,
  image: ImageCard,
  person: Person,
  route: Route,
  callout: Callout,
  chart: Chart,
};

/** 开场和引述拍压深色底，明暗的切换本身就是节奏 */
const nightKinds = new Set<VisualKind>(["quote"]);

export const accentFor = (index: number) => ACCENT_CYCLE[index % ACCENT_CYCLE.length];

export const BeatVisual: React.FC<{
  beat: Beat;
  index: number;
  total: number;
  title: string;
  shots: Shot[];
}> = ({ beat, index, title, shots }) => {
  const Component = REGISTRY[beat.visual.kind] ?? KineticText;
  const accent = accentFor(index);
  // 整片统一在"档案纸"上，只有引述拍落到暖墨黑。开场拍以前是深色，
  // 但风格板要求同一张纸底——深底会把拼贴语言打断。
  const tone = nightKinds.has(beat.visual.kind) ? "night" : "paper";
  const { pad } = useStage();

  // 镜头冲击落在这一拍第一个词上——旁白一开口，画面就"顶"一下
  const impactAt = beat.words.length ? Math.max(0, beat.words[0].t - 3) : 8;

  // 常驻运动：整帧推近 + 漂移 + 入场动量。文案密集的拍可以调 soft，
  // 纯静态信息页（图表、长列表）建议保持 normal——它们最容易被看成 PPT。
  const ambientStrength = beat.visual.ambient ?? "normal";

  // 运镜（轴一）：整幅怎么动。有运镜时关掉 ambient 自己的 zoom——
  // 两个缩放叠起来会把边缘的字切掉（推近 3.5% + 3.2% ≈ 6.7%）。
  const cameraMove = beat.visual.camera ?? "push_in";
  const camera = useCamera(beat.durationInFrames, cameraMove, index);
  const ambient = useAmbient(
    beat.durationInFrames,
    index,
    ambientStrength,
    cameraMove === "static",
  );

  // 抠图元素：back 在内容层下面（洞、底图），front 压在内文之上（盖在字前的道具）
  const cutouts = beat.visual.cutouts ?? [];
  const backCutouts = cutouts.filter((c) => !c.front);
  const frontCutouts = cutouts.filter((c) => c.front);

  return (
    <AbsoluteFill>
      {/* 运镜层：整幅（背景 + 内容）一起动。角标和章节进度条不在这一层里——
          它们是"屏幕上的 UI"，不该被镜头甩走，也不该被裁掉。 */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <AbsoluteFill
          style={{
            transform: camera.transform || undefined,
            filter: camera.blur > 0.05 ? `blur(${camera.blur.toFixed(2)}px)` : undefined,
          }}
        >
        <PaperStage
          accent={accent}
          tone={tone}
          phaseOffset={beat.from}
          image={beat.visual.image}
          imageLayout={beat.visual.imageLayout}
          imageWash={beat.visual.imageWash}
          layers={beat.visual.layers}
        >

      {/* 碎片拼贴：底图挖洞 + 几块飞入组装。放在冲击放射之后、内容之前。 */}
      {beat.visual.pieceBase && beat.visual.pieces?.length ? (
        <PieceLayer
          base={beat.visual.pieceBase}
          pieces={beat.visual.pieces}
          phaseOffset={beat.from}
          wash={beat.visual.imageWash}
          tone={tone}
          seed={index}
        />
      ) : null}

      {/* 冲击放射：画在内容下面。压在大字上面会盖住主信息，
          放射线一亮，观众先看到线、再看到字（实测）。 */}
      {beat.visual.vfx === "starburst" ? (
        <Starburst
          cx={0.5}
          cy={0.46}
          duration={26}
          seed={index}
          delay={Math.max(0, impactAt - 2)}
        />
      ) : null}

      {/* 抠图元素（后层）：洞、底物。压在文字下面，不抢主信息。 */}
      {backCutouts.length ? <CutoutLayer beat={beat} items={backCutouts} /> : null}

      {/* 镜头层：beat 内按词级锚点切成多个 <Sequence>。每个镜头自带入场配方
          和词级冲击；crossfade 让前一镜多挂 8 帧、后一镜前 8 帧淡入，两个
          Sequence 自然交叠，不进 TransitionSeries（音频时钟是 beat 级的）。 */}
      {shots.map((s, i) => (
        <Sequence
          key={i}
          from={s.from}
          durationInFrames={
            s.durationInFrames + (shots[i + 1]?.transition === "crossfade" ? SHOT_FADE : 0)
          }
          name={`${beat.id}/s${i}`}
        >
          <ShotLayer
            shot={s}
            beat={beat}
            accent={accent}
            tone={tone}
            ambientTransform={ambient}
            holdExit={i < shots.length - 1}
            fadeIn={s.transition === "crossfade" ? SHOT_FADE : 0}
            multiShot={shots.length > 1}
            fireImpact={i === 0}
            component={Component}
          />
        </Sequence>
      ))}

      {/* 抠图元素（前层）：压在内文之上，做"盖住/挡在前面"的叙事。 */}
      {frontCutouts.length ? <CutoutLayer beat={beat} items={frontCutouts} /> : null}

      {/* 红笔批注：画在内容之上、字幕之下。它跟纸一起被镜头带走，
          所以放在 PaperStage 里面，而不是像报头那样固定在画幅上。 */}
      {beat.visual.annotations?.length ? <NoteLayer notes={beat.visual.annotations} /> : null}

      {/* 漂移柔光只在没有配图时开：它是两块 accent 色斑，压在照片上会变成
          一层品红色滤镜，整张图"脏"掉。照片自己就有明暗层次。 */}
      {beat.visual.image || beat.visual.layers?.length ? null : (
        <AmbientLight seed={index} strength={ambientStrength} />
      )}

      {beat.visual.flash ? (
        <Flash at={impactAt} duration={3} max={0.6} />
      ) : null}

      {beat.visual.sweep ? (
        <LightSweep
          duration={Math.round(beat.durationInFrames * 0.7)}
          color={accent}
          delay={6}
        />
      ) : null}

          {/* 纸屑雨：撒在最上层（小小的纸片压住字没关系） */}
          {beat.visual.vfx === "confetti" ? (
            <Confetti
              duration={Math.min(80, beat.durationInFrames - 6)}
              count={46}
              seed={index}
              delay={4}
            />
          ) : null}
        </PaperStage>
        </AbsoluteFill>
      </AbsoluteFill>

      {/* 报头：画幅上的固定 UI，不受运镜影响。只有片名，没有页码 */}
      <div
        style={{
          position: "absolute",
          left: pad,
          top: 64,
          zIndex: 20,
        }}
      >
        <RunningHead title={title} accent={accent} tone={tone} />
      </div>
    </AbsoluteFill>
  );
};

export { REGISTRY };