#!/usr/bin/env node
/**
 * Authoring tool for the ExperimentsLab grid — `npm run lab`.
 *
 * Drag a file onto a tile and the tile takes that asset's exact shape; crop it
 * and the tile takes the crop's shape instead. Saving encodes the media into
 * public/ and rewrites src/config/lab-tiles.json, which is the file the Astro
 * component reads at build time.
 *
 * Deliberately a separate process rather than an Astro route: the site builds
 * to static output for GitHub Pages, so anything that writes to disk can't be
 * part of it. Kept dependency-free (node: builtins + the ffmpeg already used to
 * prepare every asset in this repo) so there's nothing to install or keep in
 * sync with the site's own dependencies.
 *
 * The crop is baked into the encoded file rather than carried into the page as
 * CSS — the component stays a plain <img>/<video>, and what ships is exactly
 * what the editor previewed.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, rename, copyFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, "public");
const TILES_FILE = path.join(ROOT, "src/config/lab-tiles.json");
const PORT = Number(process.env.PORT) || 4330;

// The rail is 1028px and each column half of it, so 1200 still covers a 2×
// display without shipping pixels nothing can resolve.
const MAX_WIDTH = 1200;

const MIME = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
};

/* ---------------------------------------------------------------- helpers */

const run = (cmd, args) =>
	new Promise((resolve, reject) => {
		const child = spawn(cmd, args);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("error", (err) =>
			reject(new Error(err.code === "ENOENT" ? `${cmd} is not installed` : err.message)),
		);
		child.on("close", (code) =>
			code === 0
				? resolve(stdout)
				: reject(new Error(`${cmd} exited ${code}\n${stderr.trim().split("\n").slice(-6).join("\n")}`)),
		);
	});

/** As `run`, but keeps stdout as bytes — raw pixel data corrupts through a string. */
const runBinary = (cmd, args) =>
	new Promise((resolve, reject) => {
		const child = spawn(cmd, args);
		const chunks = [];
		let stderr = "";
		child.stdout.on("data", (d) => chunks.push(d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-400)}`)),
		);
	});

const probe = async (file) => {
	const out = await run("ffprobe", [
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height",
		"-of",
		"json",
		file,
	]);
	const stream = JSON.parse(out).streams?.[0];
	if (!stream?.width) throw new Error("no video stream found in that file");
	return { width: stream.width, height: stream.height };
};

const readBody = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});

const slugify = (name) =>
	path
		.parse(name)
		.name.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "asset";

// h264 rejects odd dimensions, and a crop that lands on one would otherwise
// fail deep inside ffmpeg with a message that doesn't mention the crop.
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

/** Free filename in `dir`, keeping `slug` when nothing else claims it. */
const freeName = (dir, slug, ext) => {
	let candidate = path.join(dir, `${slug}${ext}`);
	let n = 2;
	while (existsSync(candidate)) candidate = path.join(dir, `${slug}-${n++}${ext}`);
	return candidate;
};

const json = (res, status, body) => {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
};

/* ------------------------------------------------------------ media encode */

/**
 * Crop + downscale one asset into public/, returning the path the page should
 * reference and the encoded file's real dimensions. Those dimensions — not the
 * source's, and not the requested crop's — become the tile's aspect, so the
 * declared ratio always matches the bytes that ship even when rounding to even
 * pixels nudges it.
 */
async function encodeMedia({ buffer, srcPath, kind, name, crop }) {
	const scratch = path.join(tmpdir(), `lab-editor-${process.pid}`);
	await mkdir(scratch, { recursive: true });

	// Either an upload (bytes in hand) or a re-crop of something already in
	// public/. Copying the latter into scratch keeps ffmpeg off a file it is
	// about to overwrite.
	let input;
	if (buffer) {
		input = path.join(scratch, `in${path.extname(name) || (kind === "video" ? ".mp4" : ".png")}`);
		await writeFile(input, buffer);
	} else {
		input = path.join(scratch, `in${path.extname(srcPath)}`);
		await copyFile(path.join(PUBLIC_DIR, srcPath.replace(/^\//, "")), input);
	}

	const source = await probe(input);

	const filters = [];
	if (crop) {
		const w = even(crop.w * source.width);
		const h = even(crop.h * source.height);
		const x = Math.max(0, Math.min(Math.round(crop.x * source.width), source.width - w));
		const y = Math.max(0, Math.min(Math.round(crop.y * source.height), source.height - h));
		filters.push(`crop=${w}:${h}:${x}:${y}`);
	}
	// `min(MAX_WIDTH, iw)` so a small source is never upscaled into a bigger file
	// than it has detail for.
	filters.push(`scale='min(${MAX_WIDTH},iw)':-2`);
	const vf = filters.join(",");

	const outDir = path.join(PUBLIC_DIR, kind === "video" ? "videos" : "images");
	await mkdir(outDir, { recursive: true });

	const slug = slugify(name || path.basename(srcPath));
	// A re-crop keeps its own filename so nothing else referencing it breaks;
	// a fresh upload takes the next free one.
	const reusePath = !buffer && srcPath;
	const ext = kind === "video" ? ".mp4" : ".jpg";
	const finalPath = reusePath
		? path.join(PUBLIC_DIR, srcPath.replace(/^\//, ""))
		: freeName(outDir, slug, ext);

	const staged = path.join(scratch, `out${ext}`);
	let posterOut;

	if (kind === "video") {
		await run("ffmpeg", [
			"-y", "-i", input,
			"-vf", vf,
			"-an",
			"-c:v", "libx264",
			"-crf", "23",
			"-preset", "slow",
			"-pix_fmt", "yuv420p",
			"-movflags", "+faststart",
			staged,
		]);
		// Poster doubles as the frame shown before autoplay gets going, so it has
		// to come from the encoded file rather than the source — same crop, same
		// scale, guaranteed.
		posterOut = finalPath.replace(/\.mp4$/, ".jpg");
		const stagedPoster = path.join(scratch, "poster.jpg");
		await run("ffmpeg", ["-y", "-i", staged, "-frames:v", "1", "-update", "1", "-q:v", "3", stagedPoster]);
		await rename(stagedPoster, posterOut).catch(async () => {
			await copyFile(stagedPoster, posterOut);
		});
	} else {
		await run("ffmpeg", ["-y", "-i", input, "-vf", vf, "-q:v", "3", staged]);
	}

	const encoded = await probe(staged);
	const placeholder = await averageColour(staged, kind === "video");

	// rename() fails across filesystems (scratch is in the OS temp dir), so fall
	// back to a copy rather than losing the encode.
	await rename(staged, finalPath).catch(async () => {
		await copyFile(staged, finalPath);
		await unlink(staged).catch(() => {});
	});

	const toPublicUrl = (p) => "/" + path.relative(PUBLIC_DIR, p).split(path.sep).join("/");

	return {
		path: toPublicUrl(finalPath),
		poster: posterOut ? toPublicUrl(posterOut) : undefined,
		width: encoded.width,
		height: encoded.height,
		placeholder,
	};
}

/**
 * The asset's average colour, by scaling it to a single pixel and reading it —
 * the tile shows this until the media has decoded, so it resolves out of its own
 * tone rather than out of a hole in the dark section. Taken from the encoded
 * file, so it matches what actually ships (crop included).
 */
async function averageColour(file, isVideo) {
	const args = ["-v", "error"];
	// A second in, so a clip that fades up from black doesn't average to black.
	if (isVideo) args.push("-ss", "1");
	args.push("-i", file);
	if (isVideo) args.push("-frames:v", "1");
	args.push("-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-");

	try {
		const out = await runBinary("ffmpeg", args);
		if (out.length < 3) return undefined;
		return "#" + [out[0], out[1], out[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
	} catch {
		// A missing placeholder just falls back to the section colour in CSS —
		// not worth failing an otherwise good encode over.
		return undefined;
	}
}

/* ------------------------------------------------------------------ routes */

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);

	try {
		if (req.method === "GET" && url.pathname === "/") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			return res.end(EDITOR_HTML);
		}

		if (req.method === "GET" && url.pathname === "/api/tiles") {
			return json(res, 200, JSON.parse(await readFile(TILES_FILE, "utf8")));
		}

		if (req.method === "POST" && url.pathname === "/api/tiles") {
			const body = JSON.parse((await readBody(req)).toString());
			// Backup beyond the in-editor undo stack: that dies with the tab, and
			// this file is the only record of a layout that took real work.
			if (existsSync(TILES_FILE)) await copyFile(TILES_FILE, `${TILES_FILE}.bak`);
			await writeFile(TILES_FILE, JSON.stringify(body, null, 2) + "\n");
			return json(res, 200, { ok: true });
		}

		if (req.method === "POST" && url.pathname === "/api/media") {
			const kind = url.searchParams.get("kind") === "video" ? "video" : "image";
			const name = url.searchParams.get("name") || "asset";
			const src = url.searchParams.get("src");
			const cropRaw = url.searchParams.get("crop");
			const crop = cropRaw
				? (([x, y, w, h]) => ({ x, y, w, h }))(cropRaw.split(",").map(Number))
				: null;
			const body = src ? null : await readBody(req);
			const result = await encodeMedia({ buffer: body, srcPath: src, kind, name, crop });
			return json(res, 200, result);
		}

		// Preview server for media already saved into public/.
		if (req.method === "GET") {
			const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
			const file = path.join(PUBLIC_DIR, rel);
			if (file.startsWith(PUBLIC_DIR) && existsSync(file)) {
				res.writeHead(200, {
					"content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
					"cache-control": "no-store",
				});
				return res.end(await readFile(file));
			}
		}

		json(res, 404, { error: "not found" });
	} catch (err) {
		console.error(err);
		json(res, 500, { error: err.message });
	}
});

server.listen(PORT, () => {
	console.log(`\n  Lab editor  →  http://localhost:${PORT}\n`);
	console.log(`  tiles   ${path.relative(ROOT, TILES_FILE)}`);
	console.log(`  media   public/images, public/videos\n`);
});

/* ------------------------------------------------------------- editor page */

const EDITOR_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lab tiles</title>
<style>
  :root {
    --bg: #0b0b0c; --panel: #151517; --line: #2a2a2e;
    --text: #f2f2f3; --dim: #8b8b93; --accent: #6c8cff; --danger: #ff6b6b;
    --radius: 12px; --gap: 16px; --rail: 1028px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.45 ui-sans-serif, -apple-system, system-ui, sans-serif; }

  header { position: sticky; top: 0; z-index: 20; display: flex; gap: 10px;
    align-items: center; padding: 12px 20px; background: rgba(11,11,12,.9);
    backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
  h1 { font-size: 14px; font-weight: 600; margin: 0 auto 0 0; letter-spacing: .01em; }
  button { font: inherit; color: var(--text); background: var(--panel);
    border: 1px solid var(--line); border-radius: 8px; padding: 7px 13px; cursor: pointer; }
  button:hover:not(:disabled) { border-color: #3d3d44; }
  button:disabled { opacity: .4; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #08080a; font-weight: 600; }
  #status { color: var(--dim); font-size: 13px; min-width: 190px; text-align: right; }
  #status.err { color: var(--danger); }

  main { padding: 28px 20px 90px; }
  /* Columns keep their natural heights — a shorter one just ends higher, which
     is what the real page now does too. */
  .grid { width: min(var(--rail), 100%); margin: 0 auto;
    display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--gap);
    align-items: start; }
  .col { display: flex; flex-direction: column; gap: var(--gap); }

  /* Mirrors .lab-tile in ExperimentsLab.astro: every tile is exactly its ratio,
     nothing stretches, so the editor shows the real layout rather than an
     approximation of it. */
  .tile { position: relative; aspect-ratio: var(--ar, 4/5); border-radius: var(--radius);
    background: linear-gradient(145deg, #fff, #f1f1f1); overflow: hidden;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.06); flex: none; }
  /* Matches ExperimentsLab.astro: a filled tile drops the white placeholder so it
     doesn't bleed a bright hairline along the rounded corners. */
  .tile:not(.empty):not(.missing) { background: transparent; }
  .tile.drop { outline: 2px dashed var(--accent); outline-offset: -6px; }
  /* An empty tile is a drop target, so it has to read as a slot rather than as
     background. Near-black on a near-black page it disappeared entirely and the
     column looked like it held fewer tiles than it does. */
  .tile.empty { background: #1c1c21; box-shadow: inset 0 0 0 1px #383840;
    outline: 1px dashed #4d4d59; outline-offset: -8px; }
  .tile.empty:hover { background: #232329; outline-color: var(--accent); }
  .tile.missing { background: #2a1416; box-shadow: inset 0 0 0 1px var(--danger); }
  .tile.missing .hint { color: var(--danger); }
  .tile.empty .hint { color: #9a9aa6; }
  /* Position in the column, so counting tiles never depends on seeing them all. */
  .idx { position: absolute; left: 8px; top: 8px; z-index: 3; font-size: 11px;
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: 5px;
    display: grid; place-content: center; background: rgba(0,0,0,.6);
    color: #cfcfd8; font-variant-numeric: tabular-nums; pointer-events: none; }
  .tile.empty .idx { background: #383840; color: #cfcfd8; }
  .tile img, .tile video { position: absolute; display: block; object-fit: fill; }
  .hint { position: absolute; inset: 0; display: grid; place-content: center;
    text-align: center; color: var(--dim); font-size: 12px; padding: 12px; }
  .meta { position: absolute; left: 8px; bottom: 8px; z-index: 3; font-size: 11px;
    padding: 3px 7px; border-radius: 6px; background: rgba(0,0,0,.66);
    color: #fff; font-variant-numeric: tabular-nums; pointer-events: none; }
  .tools { position: absolute; right: 8px; top: 8px; z-index: 3; display: flex; gap: 5px;
    opacity: 0; transition: opacity .12s; }
  .tile:hover .tools { opacity: 1; }
  .tools button { padding: 4px 9px; font-size: 12px; background: rgba(0,0,0,.72);
    border-color: rgba(255,255,255,.16); }
  .short { position: absolute; inset: auto 0 0 0; z-index: 2; padding: 4px 8px;
    font-size: 11px; background: rgba(108,140,255,.9); color: #08080a; font-weight: 600; }

  dialog { border: 1px solid var(--line); border-radius: 14px; background: var(--panel);
    color: var(--text); padding: 0; max-width: 94vw; }
  dialog::backdrop { background: rgba(0,0,0,.7); }
  .crop-head { display: flex; gap: 10px; align-items: center; padding: 12px 16px;
    border-bottom: 1px solid var(--line); }
  .crop-head strong { font-size: 13px; margin-right: auto; }
  .stage { position: relative; margin: 16px; background: #000; overflow: hidden;
    user-select: none; touch-action: none; }
  .stage img, .stage video { display: block; width: 100%; height: 100%; object-fit: contain; }
  .shade { position: absolute; inset: 0; background: rgba(0,0,0,.6); pointer-events: none; }
  .rect { position: absolute; outline: 1px solid #fff; box-shadow: 0 0 0 9999px rgba(0,0,0,.6);
    cursor: move; }
  .handle { position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 3px; }
  .handle.nw { left: -7px; top: -7px; cursor: nwse-resize; }
  .handle.ne { right: -7px; top: -7px; cursor: nesw-resize; }
  .handle.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
  .handle.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
  .crop-foot { display: flex; gap: 8px; align-items: center; padding: 0 16px 16px; }
  .crop-foot span { color: var(--dim); font-size: 12px; margin-right: auto;
    font-variant-numeric: tabular-nums; }

  .info-form { display: grid; gap: 12px; padding: 16px; width: min(460px, 90vw); }
  .info-form label { display: grid; gap: 5px; font-size: 12px; color: var(--dim); }
  .info-form input { font: inherit; font-size: 14px; color: var(--text);
    background: #0e0e10; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  .info-form input:focus { outline: none; border-color: var(--accent); }
  .info-note { font-size: 12px; color: var(--dim); line-height: 1.45; }
</style>
</head>
<body>
<header>
  <h1>Lab tiles</h1>
  <button id="fit" title="Scale the grid so every tile is on screen at once">Fit</button>
  <button id="undo" title="Cmd/Ctrl+Z">Undo</button>
  <button id="balance" title="Tune the shorter column's last empty tile so both columns end level">Balance</button>
  <button id="add">Add tile</button>
  <button id="save" class="primary">Save</button>
  <span id="status"></span>
</header>
<main><div class="grid" id="grid"></div></main>

<dialog id="cropper">
  <div class="crop-head">
    <strong>Crop</strong>
    <button id="crop-reset">Reset</button>
    <button id="crop-cancel">Cancel</button>
    <button id="crop-apply" class="primary">Apply</button>
  </div>
  <div class="stage" id="stage"></div>
  <div class="crop-foot"><span id="crop-info"></span></div>
</dialog>

<dialog id="infobox">
  <div class="crop-head">
    <strong>Caption</strong>
    <button id="info-cancel">Cancel</button>
    <button id="info-save" class="primary">Save</button>
  </div>
  <div class="info-form">
    <label>Title<input id="f-title" placeholder="Olympics Medal Tracker"></label>
    <label>Detail<input id="f-detail" placeholder="The Washington Post"></label>
    <label>Link<input id="f-href" placeholder="https://… (optional)"></label>
    <label>Link label<input id="f-action" placeholder="Visit project"></label>
    <p class="info-note">Shown under the enlarged view when the tile is clicked.
      With a link, the label replaces the detail on the right.</p>
  </div>
</dialog>

<script>
const $ = (s) => document.querySelector(s);
const statusEl = $("#status");

let state = { columns: [] };
const history = [];
const files = new Map();   // id -> File (pending upload)
const blobs = new Map();   // id -> object URL

const ratioOf = (t) => { const [w, h] = t.aspect.split("/").map(Number); return w / h; };
const hasMedia = (t) => Boolean(t.image || t.video || t._pending);
const clone = (o) => JSON.parse(JSON.stringify(o));

function say(msg, isError) {
  statusEl.textContent = msg || "";
  statusEl.className = isError ? "err" : "";
}

function snapshot() {
  history.push(JSON.stringify(state));
  if (history.length > 80) history.shift();
  $("#undo").disabled = false;
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  state = JSON.parse(prev);
  $("#undo").disabled = history.length === 0;
  render();
  say("Undone");
}

/* -------- preview geometry: place the media so the crop region fills the tile */
function mediaStyle(tile) {
  const c = tile._crop;
  // A contain-fit tile is deliberately taller than its media, with tile.bg
  // showing through the leftover — so it must not be cropped to fill.
  if (!c) return "inset:0; width:100%; height:100%; object-fit:" + (tile.fit || "cover") + ";";
  const pct = (n) => (n * 100).toFixed(4) + "%";
  return [
    "width:" + pct(1 / c.w),
    "height:" + pct(1 / c.h),
    "left:" + pct(-c.x / c.w),
    "top:" + pct(-c.y / c.h),
  ].join(";") + ";";
}

function srcOf(tile) {
  if (tile._pending) return blobs.get(tile._pending);
  return tile.video || tile.image;
}

/* ------------------------------------------------------- column arithmetic */
// Height at a fixed column width is width/ratio, so comparing columns only
// needs the sum of the inverse ratios — the width and gaps cancel out.
const inverseSum = (col) => col.reduce((sum, t) => sum + 1 / ratioOf(t), 0);

/**
 * How far the shorter column falls short of the taller one. Nothing stretches to
 * hide this any more, so the gap is visible at the bottom of the grid until
 * Balance tunes it out.
 */
function shortfall() {
  const [a, b] = state.columns.map(inverseSum);
  // 506px is the column width at the full 1028px rail.
  const px = Math.abs(a - b) * 506;
  if (px < 1) return null;
  return { shortIdx: a < b ? 0 : 1, px };
}

function render() {
  const grid = $("#grid");
  grid.innerHTML = "";
  const gap = shortfall();

  state.columns.forEach((col, ci) => {
    const colEl = document.createElement("div");
    colEl.className = "col";

    col.forEach((tile, ti) => {
      const el = document.createElement("div");
      el.className = "tile" + (hasMedia(tile) ? "" : " empty");
      el.style.setProperty("--ar", tile.aspect);
      if (tile.bg) el.style.background = tile.bg;

      const src = srcOf(tile);
      if (src) {
        const isVideo = Boolean(tile.video) || tile._kind === "video";
        const m = document.createElement(isVideo ? "video" : "img");
        m.src = src;
        if (isVideo) { m.autoplay = m.loop = m.muted = m.playsInline = true; }
        m.style.cssText = "position:absolute;" + mediaStyle(tile);
        // A tile can outlive the file it points at — deleting an asset by hand
        // leaves the reference behind, and on the real page that's an invisible
        // hole rather than an error. Say so here instead.
        m.addEventListener("error", () => {
          el.classList.add("missing");
          el.insertAdjacentHTML("beforeend",
            '<div class="hint">missing file<br>' + src + "<br>drop a replacement</div>");
        }, { once: true });
        el.appendChild(m);
      } else {
        el.insertAdjacentHTML("beforeend",
          '<div class="hint">drop image or video<br>' + tile.aspect + "</div>");
      }

      el.insertAdjacentHTML("beforeend",
        '<div class="idx">' + (ci === 0 ? "L" : "R") + (ti + 1) + "</div>");

      if (src) {
        const dims = tile._natural
          ? tile._natural.w + "×" + tile._natural.h
          : tile.aspect.replace(" / ", "×");
        el.insertAdjacentHTML("beforeend",
          '<div class="meta">' + dims + "  ·  " + ratioOf(tile).toFixed(3) + "</div>");
      }

      const tools = document.createElement("div");
      tools.className = "tools";
      if (src) {
        const crop = document.createElement("button");
        crop.textContent = "Crop";
        crop.onclick = () => openCropper(ci, ti);
        tools.appendChild(crop);
        const info = document.createElement("button");
        info.textContent = tile.title ? "Info ✓" : "Info";
        info.onclick = () => openInfo(ci, ti);
        tools.appendChild(info);
        const clear = document.createElement("button");
        clear.textContent = "Clear";
        clear.onclick = () => { snapshot(); clearTile(tile); render(); };
        tools.appendChild(clear);
      }
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "Remove tile";
      del.onclick = () => {
        if (col.length <= 1) return say("A column needs at least one tile", true);
        snapshot(); col.splice(ti, 1); render();
      };
      tools.appendChild(del);
      el.appendChild(tools);

      if (gap && gap.shortIdx === ci && ti === col.length - 1) {
        el.insertAdjacentHTML("beforeend",
          '<div class="short">column ends ' + Math.round(gap.px) + "px short — hit Balance</div>");
      }

      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop"); });
      el.addEventListener("dragleave", () => el.classList.remove("drop"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("drop");
        const file = e.dataTransfer.files[0];
        if (file) acceptFile(tile, file);
      });

      colEl.appendChild(el);
    });
    grid.appendChild(colEl);
  });

  applyFit();
}

/**
 * The grid is routinely twice the viewport tall, which makes the tiles below the
 * fold easy to miss entirely — the column looks shorter than it is. Fit scales
 * the whole thing down so every tile is visible at once. CSS zoom rather than a
 * transform because it participates in layout, so the page doesn't keep the
 * unscaled height and leave a screen of dead space underneath.
 */
let fitted = true;

// Fit is the overview, so it really does fit — with eighteen tiles that means
// going well under half size. The floor only stops it collapsing to nothing on
// an absurdly long grid; 100% is one click away for aiming a drop precisely.
const MIN_ZOOM = 0.25;

function applyFit() {
  const grid = $("#grid");
  const label = $("#fit");
  grid.style.zoom = "";
  if (!fitted) { label.textContent = "100%"; return; }
  const available = window.innerHeight - 120;
  // offsetHeight, not getBoundingClientRect: the rect comes back already scaled
  // by whatever zoom is in effect, which would feed the last zoom back into the
  // next one and ratchet the grid smaller on every render.
  const natural = grid.offsetHeight;
  const wanted = available / natural;
  const zoom = natural > available ? Math.max(MIN_ZOOM, wanted) : 1;
  grid.style.zoom = zoom.toFixed(4);
  // Says "Fit" only when it genuinely fits — past twelve or so tiles the floor
  // binds and the grid still scrolls, and claiming otherwise sends you looking
  // for tiles that are simply below the fold.
  label.textContent = (wanted < MIN_ZOOM ? "Zoom " : "Fit ") + Math.round(zoom * 100) + "%";
}

$("#fit").onclick = () => {
  fitted = !fitted;
  applyFit();
};
window.addEventListener("resize", applyFit);

function clearTile(tile) {
  if (tile._pending) { URL.revokeObjectURL(blobs.get(tile._pending)); files.delete(tile._pending); blobs.delete(tile._pending); }
  delete tile.image; delete tile.video; delete tile.poster;
  // The matte belongs to the asset that was in the tile, not to the tile.
  delete tile.fit; delete tile.bg; delete tile.placeholder;
  // The caption describes the asset that was in the tile, so it goes with it.
  delete tile.title; delete tile.detail; delete tile.href; delete tile.action;
  delete tile._pending; delete tile._kind; delete tile._natural; delete tile._crop;
  tile.aspect = "4 / 5";
}

/** Natural pixel size, which is what a tile's shape is derived from. */
function naturalSize(url, kind) {
  return new Promise((resolve, reject) => {
    if (kind === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => reject(new Error("could not read that video"));
      v.src = url;
    } else {
      const i = new Image();
      i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => reject(new Error("could not read that image"));
      i.src = url;
    }
  });
}

async function acceptFile(tile, file) {
  const kind = file.type.startsWith("video") ? "video" : "image";
  const url = URL.createObjectURL(file);
  try {
    const nat = await naturalSize(url, kind);
    snapshot();
    clearTile(tile);
    const id = crypto.randomUUID();
    files.set(id, file);
    blobs.set(id, url);
    tile._pending = id;
    tile._kind = kind;
    tile._natural = nat;
    tile.aspect = nat.w + " / " + nat.h;   // snap the tile to the content
    render();
    say(file.name + " — " + nat.w + "×" + nat.h);
  } catch (err) {
    URL.revokeObjectURL(url);
    say(err.message, true);
  }
}

/* ------------------------------------------------------------------ cropper */
let cropCtx = null;

async function openCropper(ci, ti) {
  const tile = state.columns[ci][ti];
  const src = srcOf(tile);
  if (!src) return;
  const kind = tile.video || tile._kind === "video" ? "video" : "image";
  const nat = tile._natural || (await naturalSize(src, kind));

  const stage = $("#stage");
  stage.innerHTML = "";
  // Fit the whole asset on screen; the crop rect is expressed against this box.
  const maxW = Math.min(880, window.innerWidth - 120);
  const maxH = window.innerHeight - 260;
  const scale = Math.min(maxW / nat.w, maxH / nat.h, 1);
  const boxW = Math.round(nat.w * scale);
  const boxH = Math.round(nat.h * scale);
  stage.style.width = boxW + "px";
  stage.style.height = boxH + "px";

  const m = document.createElement(kind === "video" ? "video" : "img");
  m.src = src;
  if (kind === "video") { m.autoplay = m.loop = m.muted = m.playsInline = true; }
  stage.appendChild(m);

  const rect = document.createElement("div");
  rect.className = "rect";
  rect.innerHTML = '<div class="handle nw"></div><div class="handle ne"></div>' +
                   '<div class="handle sw"></div><div class="handle se"></div>';
  stage.appendChild(rect);

  const c = tile._crop || { x: 0, y: 0, w: 1, h: 1 };
  cropCtx = { ci, ti, nat, boxW, boxH, rect, crop: { ...c } };
  drawCrop();
  $("#cropper").showModal();
}

function drawCrop() {
  const { crop, boxW, boxH, rect, nat } = cropCtx;
  rect.style.left = crop.x * boxW + "px";
  rect.style.top = crop.y * boxH + "px";
  rect.style.width = crop.w * boxW + "px";
  rect.style.height = crop.h * boxH + "px";
  const w = Math.round(crop.w * nat.w);
  const h = Math.round(crop.h * nat.h);
  $("#crop-info").textContent = w + "×" + h + "  ·  ratio " + (w / h).toFixed(3);
}

(function wireCropDrag() {
  const stage = $("#stage");
  let mode = null, startX = 0, startY = 0, origin = null;

  const pos = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  stage.addEventListener("pointerdown", (e) => {
    if (!cropCtx) return;
    stage.setPointerCapture(e.pointerId);
    const handle = e.target.classList?.contains("handle") ? e.target.classList[1] : null;
    const p = pos(e);
    startX = p.x; startY = p.y;
    origin = { ...cropCtx.crop };
    // A handle resizes, the rect itself moves, and bare stage draws a new box.
    // Except at full extent, where there is no bare stage to grab and moving is
    // a no-op anyway — so the first drag draws instead of silently doing nothing.
    const atFullExtent = origin.w > .999 && origin.h > .999;
    const inside = e.target === cropCtx.rect && !atFullExtent;
    mode = handle ? "resize:" + handle : (inside ? "move" : "draw");
    if (mode === "draw") { cropCtx.crop = { x: p.x, y: p.y, w: 0, h: 0 }; drawCrop(); }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!cropCtx || !mode) return;
    const p = pos(e);
    const dx = p.x - startX, dy = p.y - startY;
    const c = cropCtx.crop;

    if (mode === "move") {
      c.x = clamp01(Math.min(origin.x + dx, 1 - origin.w));
      c.y = clamp01(Math.min(origin.y + dy, 1 - origin.h));
    } else if (mode === "draw") {
      c.x = clamp01(Math.min(startX, p.x));
      c.y = clamp01(Math.min(startY, p.y));
      c.w = Math.min(Math.abs(dx), 1 - c.x);
      c.h = Math.min(Math.abs(dy), 1 - c.y);
    } else {
      const dir = mode.split(":")[1];
      let { x, y, w, h } = origin;
      if (dir.includes("w")) { const nx = clamp01(Math.min(x + dx, x + w - .02)); w += x - nx; x = nx; }
      if (dir.includes("n")) { const ny = clamp01(Math.min(y + dy, y + h - .02)); h += y - ny; y = ny; }
      if (dir.includes("e")) w = Math.max(.02, Math.min(w + dx, 1 - x));
      if (dir.includes("s")) h = Math.max(.02, Math.min(h + dy, 1 - y));
      Object.assign(c, { x, y, w, h });
    }
    drawCrop();
  });

  const stop = () => { mode = null; };
  stage.addEventListener("pointerup", stop);
  stage.addEventListener("pointercancel", stop);
})();

$("#crop-reset").onclick = () => { cropCtx.crop = { x: 0, y: 0, w: 1, h: 1 }; drawCrop(); };
$("#crop-cancel").onclick = () => { $("#cropper").close(); cropCtx = null; };
$("#crop-apply").onclick = () => {
  const { ci, ti, nat, crop } = cropCtx;
  if (crop.w < .02 || crop.h < .02) return say("Crop is too small", true);
  const tile = state.columns[ci][ti];
  snapshot();
  const full = crop.w > .999 && crop.h > .999 && crop.x < .001 && crop.y < .001;
  tile._crop = full ? null : { ...crop };
  const w = Math.round(crop.w * nat.w), h = Math.round(crop.h * nat.h);
  tile.aspect = w + " / " + h;           // tile follows the crop
  $("#cropper").close();
  cropCtx = null;
  render();
  say("Cropped to " + w + "×" + h);
};

/* ------------------------------------------------------------------- caption */
let infoTarget = null;

function openInfo(ci, ti) {
  const tile = state.columns[ci][ti];
  infoTarget = tile;
  $("#f-title").value = tile.title || "";
  $("#f-detail").value = tile.detail || "";
  $("#f-href").value = tile.href || "";
  $("#f-action").value = tile.action || "";
  $("#infobox").showModal();
  $("#f-title").focus();
}

$("#info-cancel").onclick = () => { $("#infobox").close(); infoTarget = null; };

$("#info-save").onclick = () => {
  if (!infoTarget) return;
  snapshot();
  // Empty inputs clear the field rather than writing "", so the saved JSON
  // stays free of keys that mean nothing.
  for (const [key, sel] of [["title","#f-title"],["detail","#f-detail"],["href","#f-href"],["action","#f-action"]]) {
    const value = $(sel).value.trim();
    if (value) infoTarget[key] = value;
    else delete infoTarget[key];
  }
  $("#infobox").close();
  infoTarget = null;
  render();
  say("Caption updated — Save to write it out");
};

/* -------------------------------------------------------------- balance/save */
$("#balance").onclick = () => {
  const info = shortfall();
  if (!info) return say("Columns already level");
  const col = state.columns[info.shortIdx];
  const last = col[col.length - 1];
  if (hasMedia(last)) {
    return say("Last tile holds media — add an empty tile to absorb it", true);
  }
  const target = Math.max(...state.columns.map(inverseSum));
  const need = target - (inverseSum(col) - 1 / ratioOf(last));
  if (need <= 0.01) return say("No room to balance in that column", true);
  snapshot();
  // Ratios elsewhere are exact pixel pairs, so express this one the same way
  // rather than as a decimal the component would have to parse differently.
  last.aspect = Math.round((1 / need) * 1000) + " / 1000";
  render();
  say("Balanced — columns now level to " + Math.round((shortfall()?.px) || 0) + "px");
};

$("#add").onclick = () => {
  snapshot();
  const shorter = inverseSum(state.columns[0]) <= inverseSum(state.columns[1]) ? 0 : 1;
  state.columns[shorter].push({ aspect: "4 / 5" });
  render();
};

$("#undo").onclick = undo;
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
    // Undo would yank the state out from under an open dialog, and inside the
    // caption inputs Cmd+Z should undo typing, not the grid.
    if ($("#cropper").open || $("#infobox").open) return;
    e.preventDefault(); undo();
  }
});

$("#save").onclick = async () => {
  const btn = $("#save");
  btn.disabled = true;
  try {
    for (const col of state.columns) {
      for (const tile of col) {
        const needsEncode = tile._pending || tile._crop;
        if (!needsEncode) continue;

        const file = tile._pending ? files.get(tile._pending) : null;
        const kind = tile._kind === "video" || tile.video ? "video" : "image";
        const params = new URLSearchParams({ kind });
        if (file) params.set("name", file.name);
        else params.set("src", tile.video || tile.image);
        if (tile._crop) {
          const c = tile._crop;
          params.set("crop", [c.x, c.y, c.w, c.h].join(","));
        }

        say("Encoding " + (file ? file.name : (tile.video || tile.image)) + "…");
        const res = await fetch("/api/media?" + params, {
          method: "POST",
          body: file || undefined,
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error);

        clearTile(tile);
        if (kind === "video") { tile.video = out.path; tile.poster = out.poster; }
        else tile.image = out.path;
        // The encoded file's real dimensions, so the declared ratio and the
        // shipped bytes can't drift apart.
        tile.aspect = out.width + " / " + out.height;
        if (out.placeholder) tile.placeholder = out.placeholder;
        tile._natural = { w: out.width, h: out.height };
      }
    }

    const payload = {
      columns: state.columns.map((col) =>
        col.map((t) => {
          const out = { aspect: t.aspect };
          if (t.video) { out.video = t.video; if (t.poster) out.poster = t.poster; }
          if (t.image) out.image = t.image;
          // Hand-authored in lab-tiles.json, not settable here yet — carried
          // through so a save doesn't quietly drop a tile's matte.
          if (t.fit) out.fit = t.fit;
          if (t.bg) out.bg = t.bg;
          // Computed by the server on encode; the page fades this out once the
          // asset decodes.
          if (t.placeholder) out.placeholder = t.placeholder;
          // Caption for the enlarged view (see the Info panel).
          for (const key of ["title", "detail", "href", "action"]) {
            if (t[key]) out[key] = t[key];
          }
          return out;
        }),
      ),
    };
    const res = await fetch("/api/tiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    render();
    say("Saved — reload the Astro dev server tab");
  } catch (err) {
    say(err.message, true);
  } finally {
    btn.disabled = false;
  }
};

/* -------------------------------------------------------------------- boot */
// Stop a missed drop from navigating the page away and losing unsaved work.
["dragover", "drop"].forEach((ev) =>
  document.addEventListener(ev, (e) => e.preventDefault()),
);
window.addEventListener("beforeunload", (e) => {
  const dirty = state.columns.some((c) => c.some((t) => t._pending || t._crop));
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

fetch("/api/tiles")
  .then((r) => r.json())
  .then((data) => {
    state = data;
    $("#undo").disabled = true;
    render();
  })
  .catch((err) => say(err.message, true));
</script>
</body>
</html>`;
