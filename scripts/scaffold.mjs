#!/usr/bin/env node
/**
 * 从模板立一个新项目。
 *
 *   node scaffold.mjs --slug my-video --out "E:\AI\视频制作"
 *   node scaffold.mjs --slug my-video --from "E:\AI\视频制作\demo"   # 复用已有依赖
 *
 * 装依赖约 4 分钟，建议后台跑。已经装过的项目用 --from 走目录联接，
 * 秒级完成。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, "..", "assets", "template");

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const out = { slug: "", out: homedir(), from: "", link: false, noInstall: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug") out.slug = argv[++i] ?? "";
    else if (a === "--out") out.out = argv[++i] ?? "";
    else if (a === "--from") out.from = argv[++i] ?? "";
    else if (a === "--link") out.link = true;
    else if (a === "--no-install") out.noInstall = true;
    else if (a === "-h" || a === "--help") {
      console.log("用法: node scaffold.mjs --slug <名字> [--out <目录>] [--from <已有项目>] [--link] [--no-install]");
      process.exit(0);
    }
  }
  return out;
}

// ------------------------------------------------------------------ placeholder timeline

/**
 * 生成一份**占位** timeline.json，让 `remotion studio` 在还没跑 TTS 时也能打开。
 * 帧数是按字数粗估的，仅供看组件长相；跑一次 vox_tts.py 就会被真实测量覆盖。
 */
function placeholderTimeline(script) {
  const fps = script.fps ?? 30;
  const ratePct = parseInt(String(script.rate ?? "+0%"), 10) || 0;
  const cps = 5.2 * (1 + ratePct / 100); // 中文基准约 5.2 字/秒

  let cursor = 0;
  const beats = (script.beats ?? []).map((b) => {
    const text = (b.narration ?? "").trim();
    const padAfter = b.padAfter ?? 0.35;
    const padBefore = b.padBefore ?? 0;

    if (!text) {
      const hold = Math.max(1, Math.round((b.hold ?? padBefore + padAfter) * fps));
      const beat = {
        id: b.id, from: cursor, durationInFrames: hold, audioFrom: null,
        narration: "", words: [], visual: b.visual ?? { kind: "kinetic" },
      };
      cursor += hold;
      return beat;
    }

    // 按标点粗切词，中文 TTS 的 boundary 大致就是这么切的
    const tokens = text.split(/(?<=[，。！？；、,.!?;])/).filter(Boolean);
    const speech = Math.max(1, Math.round((text.replace(/\s/g, "").length / cps) * fps));
    const audioFrom = Math.round(padBefore * fps);
    const duration = audioFrom + speech + Math.round(padAfter * fps);

    // 按字数比例把 speech 分给各 token
    const weights = tokens.map((t) => t.replace(/\s/g, "").length);
    const totalW = weights.reduce((a, c) => a + c, 0) || 1;
    let acc = 0;
    const words = tokens.map((t, i) => {
      const t0 = audioFrom + Math.round((acc / totalW) * speech);
      acc += weights[i];
      const d = Math.max(1, Math.round((weights[i] / totalW) * speech));
      return { t: t0, d, text: t };
    });

    const beat = {
      id: b.id, from: cursor, durationInFrames: duration, audioFrom,
      narration: b.narration, words, visual: b.visual ?? { kind: "kinetic" },
    };
    cursor += duration;
    return beat;
  });

  return {
    title: script.title ?? "untitled",
    voice: script.voice ?? "zh-CN-YunjianNeural",
    rate: script.rate ?? "+0%",
    fps,
    width: script.width ?? 1920,
    height: script.height ?? 1080,
    totalFrames: cursor + Math.round(0.6 * fps),
    beats,
  };
}

/**
 * 递归复制目录。
 *
 * 不用 fs.cpSync：在部分 Windows + Node 22 组合上它对目录会**静默复制 0 个文件**
 * 且不报错（单文件却正常）。这里手写，行为可预期，也顺带跳过 node_modules。
 */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out" || entry.name === ".venv-tts") continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

// ------------------------------------------------------------------ main

function main() {
  const args = parseArgs(process.argv);
  if (!args.slug) {
    console.error("缺少 --slug。例如: node scaffold.mjs --slug voyager --out \"E:\\AI\\视频制作\"");
    process.exit(1);
  }
  // 参数校验必须在动文件系统之前，否则报错时会留下半成品目录
  if (args.link && !args.from) {
    console.error("--link 需要配合 --from <已有项目>：它靠联接对方的 node_modules 来省掉安装。");
    process.exit(1);
  }

  const target = join(resolve(args.out), args.slug);
  if (existsSync(target)) {
    console.error(`目标已存在：${target}\n换个 slug，或先删掉它。`);
    process.exit(1);
  }

  console.log(`[scaffold] ${TEMPLATE}\n        -> ${target}`);
  mkdirSync(target, { recursive: true });
  copyTree(TEMPLATE, target);

  // 把 vox_tts.py 的绝对路径写进 npm script。
  // 模板里只能留占位符——项目建在哪台机器的哪个目录下，模板无从得知，
  // 而写死相对路径必然在某些目录布局下指向错误位置。
  const pkgPath = join(target, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.scripts.tts = `python "${resolve(HERE, "vox_tts.py")}" --project .`;
  pkg.scripts.preflight = `python "${resolve(HERE, "preflight.py")}" --project .`;
  pkg.scripts.stills = `python "${resolve(HERE, "stills.py")}" --project . --sheet`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  // script.json：复制示例（如果调用方已经准备了自己的，优先用它）
  const scriptPath = join(target, "script.json");
  if (!existsSync(scriptPath)) {
    const example = resolve(HERE, "..", "assets", "script.example.json");
    writeFileSync(scriptPath, readFileSync(example, "utf8"), "utf8");
    console.log("[scaffold] 已放入示例 script.json —— 直接改这个文件");
  }

  // 占位时间轴，保证 studio 能立刻打开
  const script = JSON.parse(readFileSync(scriptPath, "utf8"));
  const tlPath = join(target, "src", "timeline.json");
  writeFileSync(tlPath, JSON.stringify(placeholderTimeline(script), null, 2), "utf8");

  mkdirSync(join(target, "public", "audio"), { recursive: true });
  mkdirSync(join(target, "public", "img"), { recursive: true });
  mkdirSync(join(target, "out"), { recursive: true });

  // ---- 依赖
  const destModules = join(target, "node_modules");
  const fromModules = args.from ? join(resolve(args.from), "node_modules") : "";

  if (fromModules && existsSync(fromModules)) {
    if (!fromModules || !existsSync(fromModules)) {
      console.error(`--from 指向的项目没有 node_modules：${fromModules || "(未提供 --from)"}`);
      process.exit(1);
    }
    if (existsSync(destModules)) rmSync(destModules, { recursive: true, force: true });
    try {
      symlinkSync(fromModules, destModules, "junction");
      console.log(`[scaffold] node_modules → ${fromModules}（目录联接，秒级）`);
      console.log("[scaffold] 完成。接下来：");
      console.log(`  1. 编辑 ${scriptPath}`);
      console.log(`  2. cd "${target}" && npm run tts`);
      console.log(`  3. npx remotion studio`);
      return;
    } catch (err) {
      console.warn(`[scaffold] 联接失败（${err.message}），退回正常安装`);
    }
  }

  if (args.noInstall) {
    console.log("[scaffold] 跳过依赖安装。接下来：");
    console.log(`  cd "${target}" && npm install`);
    return;
  }

  console.log("[scaffold] 安装依赖（258 个包，约 4 分钟）...");
  const t0 = Date.now();
  try {
    execSync("npm install --no-audit --no-fund", {
      cwd: target,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    console.log(`[scaffold] 依赖就绪（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  } catch {
    console.error("[scaffold] npm install 失败。手动执行：");
    console.error(`  cd "${target}" && npm install`);
    process.exit(1);
  }

  console.log("[scaffold] 完成。接下来：");
  console.log(`  1. 编辑 ${scriptPath}`);
  console.log(`  2. cd "${target}" && npm run tts`);
  console.log(`  3. npx remotion studio`);
}

main();