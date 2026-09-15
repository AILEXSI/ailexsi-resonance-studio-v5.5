/**
 * Generate deterministic frame-identity H.264 MP4s for AFE-01.
 * Test-only. Not copied into dist / public / Tauri.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { AFE_HEIGHT, AFE_WIDTH, paintIdentityFrame } from "./afe-shared.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "afe");
mkdirSync(outDir, { recursive: true });

const SPECS = [
  { id: "afe-cfr-30-g1-2s", fps: 30, seconds: 2, gop: 1, bf: 0 },
  { id: "afe-cfr-30-g24-2s", fps: 30, seconds: 2, gop: 24, bf: 0 },
  { id: "afe-cfr-30-g25-2s", fps: 30, seconds: 2, gop: 25, bf: 0 },
  { id: "afe-cfr-30-g30-2s", fps: 30, seconds: 2, gop: 30, bf: 0 },
  { id: "afe-cfr-30-g50-3s", fps: 30, seconds: 3, gop: 50, bf: 0 },
  { id: "afe-cfr-30-g60-8s", fps: 30, seconds: 8, gop: 60, bf: 0 },
  { id: "afe-cfr-30-g250-28s", fps: 30, seconds: 28, gop: 250, bf: 0 },
  { id: "afe-cfr-24-g24-2s", fps: 24, seconds: 2, gop: 24, bf: 0 },
  { id: "afe-cfr-25-g25-2s", fps: 25, seconds: 2, gop: 25, bf: 0 },
  { id: "afe-cfr-50-g50-2s", fps: 50, seconds: 2, gop: 50, bf: 0 },
  { id: "afe-cfr-60-g60-2s", fps: 60, seconds: 2, gop: 60, bf: 0 },
  { id: "afe-cfr-30-g30-720p-2s", fps: 30, seconds: 2, gop: 30, bf: 0, width: 1280, height: 720 },
  { id: "afe-bframe-30-g30-2s", fps: 30, seconds: 2, gop: 30, bf: 2, profile: "main" },
  { id: "afe-bframe-30-g60-4s", fps: 30, seconds: 4, gop: 60, bf: 2, profile: "main" },
  { id: "afe-bframe-30-g15-2s", fps: 30, seconds: 2, gop: 15, bf: 3, profile: "high" },
  { id: "afe-bframe-30-g30-720p-2s", fps: 30, seconds: 2, gop: 30, bf: 2, profile: "main", width: 1280, height: 720 },
];

function runFfmpeg(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}\n${err.slice(-2000)}`));
    });
    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

async function encodeSpec(spec) {
  const width = spec.width ?? AFE_WIDTH;
  const height = spec.height ?? AFE_HEIGHT;
  const frames = Math.round(spec.fps * spec.seconds);
  const frameSize = width * height * 3;
  const raw = Buffer.alloc(frames * frameSize);
  for (let n = 0; n < frames; n++) {
    paintIdentityFrame(raw.subarray(n * frameSize, (n + 1) * frameSize), width, height, n);
  }
  const file = join(outDir, `${spec.id}.mp4`);
  const bf = spec.bf ?? 0;
  const profile = spec.profile ?? (bf > 0 ? "main" : "baseline");
  const x264 =
    bf > 0
      ? `keyint=${spec.gop}:min-keyint=${spec.gop}:scenecut=0:bframes=${bf}:b-adapt=0:b-pyramid=0`
      : `keyint=${spec.gop}:min-keyint=${spec.gop}:scenecut=0`;
  await runFfmpeg(
    [
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${width}x${height}`,
      "-r",
      String(spec.fps),
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      profile,
      "-bf",
      String(bf),
      "-g",
      String(spec.gop),
      "-keyint_min",
      String(spec.gop),
      "-x264-params",
      x264,
      "-movflags",
      "+faststart",
      file,
    ],
    raw,
  );
  return { ...spec, width, height, frames, bf, profile, file: `tests/fixtures/afe/${spec.id}.mp4` };
}

function findCtts(bytes) {
  const text = Buffer.from(bytes);
  let from = 0;
  while (from < text.length - 8) {
    const idx = text.indexOf(Buffer.from("ctts"), from);
    if (idx < 0) return null;
    if (idx >= 4) {
      const size = text.readUInt32BE(idx - 4);
      if (size >= 16 && idx - 4 + size <= text.length) {
        const version = text[idx + 4] ?? 0;
        const entryCount = text.readUInt32BE(idx + 8);
        const offsets = new Set();
        let cursor = idx + 12;
        const end = idx - 4 + size;
        for (let i = 0; i < entryCount && cursor + 8 <= end; i++) {
          const off =
            version === 1 ? text.readInt32BE(cursor + 4) : text.readUInt32BE(cursor + 4);
          offsets.add(off);
          cursor += 8;
        }
        return { version, entryCount, uniqueOffsets: offsets.size, offsets: [...offsets] };
      }
    }
    from = idx + 4;
  }
  return null;
}

/** If ctts is v1 with only non-negative offsets, rewrite as v0 (same bit pattern). */
function maybeWriteCttsV0(srcAbs, destAbs) {
  const bytes = Buffer.from(readFileSync(srcAbs));
  const info = findCtts(bytes);
  if (!info || info.version !== 1) return null;
  if (info.offsets.some((n) => n < 0)) return null;
  const text = bytes;
  let from = 0;
  while (from < text.length - 8) {
    const idx = text.indexOf(Buffer.from("ctts"), from);
    if (idx < 0) break;
    if (idx >= 4) {
      text[idx + 4] = 0;
      writeFileSync(destAbs, text);
      return findCtts(text);
    }
    from = idx + 4;
  }
  return null;
}

function probePictTypes(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "frame=pict_type",
        "-of",
        "csv=p=0",
        file,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe pict_type exit ${code}\n${err}`));
        return;
      }
      const types = out
        .trim()
        .split("\n")
        .map((line) => (line.trim().split(",")[0] ?? "").trim())
        .filter(Boolean);
      resolve(types);
    });
  });
}

function probeKeyframes(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-skip_frame",
        "nokey",
        "-show_entries",
        "frame=pts_time,pict_type",
        "-of",
        "csv=p=0",
        file,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit ${code}\n${err}`));
        return;
      }
      const times = out
        .trim()
        .split("\n")
        .map((line) => Number.parseFloat(line.split(",")[0] ?? ""))
        .filter((n) => Number.isFinite(n));
      resolve(times);
    });
  });
}

async function main() {
  const files = [];
  for (const spec of SPECS) {
    const encoded = await encodeSpec(spec);
    const abs = join(outDir, `${spec.id}.mp4`);
    const keyframes = await probeKeyframes(abs);
    const pict = await probePictTypes(abs);
    const ctts = findCtts(readFileSync(abs));
    const bCount = pict.filter((t) => t === "B").length;
    files.push({
      id: spec.id,
      fps: spec.fps,
      seconds: spec.seconds,
      gop: spec.gop,
      width: encoded.width,
      height: encoded.height,
      frames: encoded.frames,
      path: encoded.file,
      keyframeSec: keyframes,
      bf: encoded.bf ?? 0,
      profile: encoded.profile ?? "baseline",
      bframes: bCount,
      pictTypes: [...new Set(pict)],
      cttsVersion: ctts?.version ?? null,
      cttsUniqueOffsets: ctts?.uniqueOffsets ?? 0,
      nobControl: (encoded.bf ?? 0) === 0,
    });
    console.log(
      "wrote",
      encoded.file,
      "frames",
      encoded.frames,
      "keyframes",
      keyframes.length,
      "B",
      bCount,
      "ctts",
      ctts,
    );

    if ((encoded.bf ?? 0) > 0 && spec.id === "afe-bframe-30-g30-2s" && ctts && ctts.offsets.every((n) => n >= 0)) {
      const otherVersion = ctts.version === 0 ? 1 : 0;
      const altId = `${spec.id}-ctts-v${otherVersion}`;
      const altAbs = join(outDir, `${altId}.mp4`);
      const bytes = Buffer.from(readFileSync(abs));
      const text = bytes;
      let from = 0;
      while (from < text.length - 8) {
        const idx = text.indexOf(Buffer.from("ctts"), from);
        if (idx < 0) break;
        if (idx >= 4) {
          text[idx + 4] = otherVersion;
          writeFileSync(altAbs, text);
          break;
        }
        from = idx + 4;
      }
      const altCtts = findCtts(readFileSync(altAbs));
      const altKf = await probeKeyframes(altAbs);
      files.push({
        id: altId,
        fps: spec.fps,
        seconds: spec.seconds,
        gop: spec.gop,
        width: encoded.width,
        height: encoded.height,
        frames: encoded.frames,
        path: `tests/fixtures/afe/${altId}.mp4`,
        keyframeSec: altKf,
        bf: encoded.bf,
        profile: encoded.profile,
        bframes: bCount,
        pictTypes: [...new Set(pict)],
        cttsVersion: otherVersion,
        cttsUniqueOffsets: altCtts?.uniqueOffsets ?? ctts.uniqueOffsets,
        nobControl: false,
        rewrittenCttsVersion: otherVersion,
      });
      console.log("wrote", `tests/fixtures/afe/${altId}.mp4`, "ctts version rewrite", otherVersion);
    }
  }
  const manifest = {
    generated: true,
    note: "Deterministic frame-identity H.264 (barcode). Test-only. Not product media.",
    width: AFE_WIDTH,
    height: AFE_HEIGHT,
    files,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(
    join(outDir, "README.md"),
    [
      "# AFE frame-identity fixtures",
      "",
      "Generated by `node scripts/generate-afe-media.mjs`.",
      "Each frame encodes its presentation index as a 4×4 black/white barcode.",
      "Includes no-B (baseline, `-bf 0`) controls and B-frame / varying-CTTS files.",
      "FFmpeg is the fixture generator only — not a runtime dependency.",
      "Test-only. Not for product distribution.",
      "",
    ].join("\n"),
  );
  console.log("manifest", files.length, "files");
}

await main();
