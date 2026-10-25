/**
 * 主合成：把 timeline.json 变成一条成片。
 *
 * 这个文件**不需要改**。帧数、音频起点、每拍的起止全部来自
 * src/timeline.json，而 timeline.json 是 vox_tts.py 量出来的。
 * 想改节奏请改 script.json 再重跑 TTS，不要在这里写死任何帧数——
 * 那样做会让画面立刻和配音错位。
 *
 * 音画是**分开摆**的，这是这个架构的关键：
 *
 *   视觉  走 TransitionSeries，相邻两拍交叠做转场，位置由 Remotion 算。
 *   音频  按实测位置 from + audioFrom 绝对摆放，完全不参与交叠。
 *
 * 所以改转场不会让旁白错位——转场是纯视觉决策，而音频始终是那个"时钟"。
 * 绝大多数视频事故（音画从片尾开始漂移）都源于把这两件事混在一起排。
 */

import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { BEATS, TIMELINE } from "./timeline";
import { computeShots } from "./shots";
import { BeatVisual } from "./visuals";
import { CaptionTrack, ChapterProgress } from "./components";
import { transitionFor } from "./transitions";
import { Grain } from "./effects";
import { FontGate } from "./fonts";
import { MusicBed } from "./music";
import { COLORS } from "./theme";

export const VoxVideo: React.FC = () => {
  // clockWipe / iris 需要画幅尺寸，在组件顶层取一次，不在 map 回调里调 hook
  const { width, height, fps } = useVideoConfig();

  // 镜头拆分要按**全片**镜头序号轮换配方，所以游标跨拍累加——这样跨拍边界
  // 的相邻两镜也不会撞同一套入场。纯函数预计算，空拍词流也不会有副作用。
  const shotsByBeat = React.useMemo(() => {
    let cursor = 0;
    return BEATS.map((b) => {
      const s = computeShots(b, cursor, fps);
      cursor += s.length;
      return s;
    });
  }, [fps]);

  return (
    <FontGate>
    <AbsoluteFill style={{ backgroundColor: COLORS.stage }}>
      {/* ---- 音频：按实测位置绝对摆放，不参与任何转场 ---- */}
      {BEATS.map((beat) =>
        beat.audioFrom === null ? null : (
          <Sequence
            key={`audio-${beat.id}`}
            from={beat.from + beat.audioFrom}
            durationInFrames={Math.max(1, beat.durationInFrames - beat.audioFrom)}
            name={`♪ ${beat.id}`}
          >
            <Audio src={staticFile(`audio/${beat.id}.mp3`)} />
          </Sequence>
        ),
      )}

      {/* ---- 视觉：TransitionSeries 负责交叠转场 ---- */}
      <TransitionSeries>
        {BEATS.map((beat, i) => {
          const nodes = [];
          if (i > 0 && beat.transitionFrames > 0) {
            nodes.push(
              <TransitionSeries.Transition
                key={`t-${beat.id}`}
                presentation={transitionFor(beat.transition, { width, height })}
                timing={linearTiming({ durationInFrames: beat.transitionFrames })}
              />,
            );
          }
          nodes.push(
            <TransitionSeries.Sequence
              key={beat.id}
              durationInFrames={beat.durationInFrames}
              name={beat.id}
              // 提前挂载，避免切到这一拍的第一帧组件还没准备好导致闪一下
              premountFor={30}
            >
              <BeatVisual
                beat={beat}
                index={i}
                total={BEATS.length}
                title={TIMELINE.title}
                shots={shotsByBeat[i] ?? []}
              />
            </TransitionSeries.Sequence>,
          );
          return nodes;
        })}
      </TransitionSeries>

      {/* ---- 配乐：在有人说话的地方自动让路（ducking）---- */}
      {TIMELINE.music?.src ? (
        <MusicBed music={TIMELINE.music} totalFrames={TIMELINE.totalFrames} />
      ) : null}

      <ChapterProgress
        durationInFrames={TIMELINE.totalFrames}
        beatStarts={BEATS.map((b) => b.from)}
      />

      {/* 字幕跟随旁白，不跟视觉。全局一层，读全部 beats */}
      {TIMELINE.captions ? (
        <CaptionTrack totalFrames={TIMELINE.totalFrames} />
      ) : null}

      {/* 胶片颗粒。极淡，只是为了让纯色背景不那么"数字化" */}
      <Grain opacity={0.035} />
    </AbsoluteFill>
    </FontGate>
  );
};