import React from "react";
import { Composition, Still } from "remotion";
import { TIMELINE } from "./timeline";
import { VoxVideo } from "./VoxVideo";

/**
 * durationInFrames 绑定的是 timeline.totalFrames —— 也就是全部配音测完之后的总长。
 * 换脚本 → 重跑 vox_tts.py → 这里自动跟着变，不需要手动同步。
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VoxVideo"
        component={VoxVideo}
        durationInFrames={Math.max(1, TIMELINE.totalFrames)}
        fps={TIMELINE.fps}
        width={TIMELINE.width}
        height={TIMELINE.height}
      />

      {/* 封面：取第 45 帧附近，通常正好落在 hook 上 */}
      <Still
        id="Cover"
        component={VoxVideo}
        width={TIMELINE.width}
        height={TIMELINE.height}
      />
    </>
  );
};