/*
  Playing a tracker's files inside the app.

  GET /media?u=<the link as the tracker wrote it>

  A tracker cell holds a page about a file (pillows.su/f/..., a Drive share
  link, an imgur.gg page), not the file. The link is worked out here into the
  address of the file itself and piped back with a type a browser will play,
  ranges and all, so the page can hand it straight to a media element.

  Only hosts this file knows are ever fetched - the address comes from the query
  string, and a server that fetches whatever it is handed is a hole.

  Audio a browser cannot decode as it comes (ALAC, WMA, AIFF...) is put through
  ffmpeg once and kept in the temp folder. Video is passed through untouched.
  Adding &convert=1 forces the ffmpeg route; the page asks for that when a file
  would not play the plain way.
*/
const fetch = require("node-fetch");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { pipeline } = require("stream");

const UA = { "User-Agent": "Mozilla/5.0" };

const MIME = {
  mp3: "audio/mpeg", m4a: "audio/mp4", m4b: "audio/mp4", aac: "audio/aac",
  wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  aiff: "audio/aiff", aif: "audio/aiff", alac: "audio/mp4", wma: "audio/x-ms-wma", caf: "audio/x-caf",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska"
};
const VIDEO_NAME = /\.(mp4|m4v|mov|webm|mkv)$/i;
const mimeForName = name => MIME[String(name || "").split(/[?#]/)[0].split(".").pop().toLowerCase()] || null;

// what a browser will not play straight off the host
const NEEDS_CONVERSION = /^audio\/(aiff|x-aiff|x-ms-wma|x-caf|amr|3gpp2?)/i;

function detectType(buf) {
  if (!buf || buf.length < 12) return null;
  const ascii = (start, end) => buf.slice(start, end).toString("ascii");

  if (ascii(4, 8) === "ftyp") return /^(M4A|M4B)/.test(ascii(8, 12)) ? "audio/mp4" : ascii(8, 10) === "qt" ? "video/quicktime" : "video/mp4";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "FORM" && ascii(8, 12) === "AIFF") return "audio/aiff";
  if (ascii(0, 4) === "caff") return "audio/x-caf";
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return "video/webm";
  if (buf.readUInt32BE(0) === 0x3026b275) return "audio/x-ms-wma";
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return "audio/aac";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

const probed = new Map();
async function probeType(url) {
  if (probed.has(url)) return probed.get(url);
  let found = null;
  try {
    const response = await fetch(url, { headers: { ...UA, Range: "bytes=0-15" } });
    if (response.ok || response.status === 206) {
      // a host that ignores the range sends the whole file: take the start and hang up
      found = await new Promise(resolve => {
        const parts = [];
        let size = 0;
        const done = () => { resolve(detectType(Buffer.concat(parts))); if (response.body.destroy) response.body.destroy(); };
        response.body.on("data", chunk => { parts.push(chunk); size += chunk.length; if (size >= 16) done(); });
        response.body.on("end", done);
        response.body.on("error", () => resolve(null));
      });
    }
  } catch (err) {}
  if (probed.size > 5000) probed.clear();
  probed.set(url, found);
  return found;
}

/* ------------------------------------------------------------------ ffmpeg */
const FFMPEG = (() => {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = require("ffmpeg-static");
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (err) {}
  return "ffmpeg";
})();

const CONVERT_DIR = path.join(os.tmpdir(), "tracker-search-audio");
const CACHE_MAX_BYTES = (Number(process.env.CONVERT_CACHE_MB) || 1024) * 1024 * 1024;
const SOURCE_MAX_BYTES = 600 * 1024 * 1024;
const CONVERTED_TYPES = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".flac": "audio/flac" };
const conversions = new Map();
let ffmpegMissing = false;

const keyFor = url => crypto.createHash("sha1").update(url).digest("hex");

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let stderr = "", child;
    try { child = spawn(FFMPEG, ["-hide_banner", "-nostdin", ...args], { windowsHide: true }); }
    catch (err) { return reject(err); }
    child.stderr.on("data", chunk => { if (stderr.length < 200000) stderr += chunk.toString(); });
    child.on("error", err => { if (err.code === "ENOENT") ffmpegMissing = true; reject(err); });
    child.on("close", code => resolve({ code, stderr }));
  });
}

function findConverted(key) {
  for (const ext of Object.keys(CONVERTED_TYPES)) {
    const file = path.join(CONVERT_DIR, key + ext);
    try { if (fs.statSync(file).size > 0) return file; } catch (err) {}
  }
  return null;
}

// oldest files go first once the folder passes its size limit
function pruneConverted() {
  try {
    const files = fs.readdirSync(CONVERT_DIR).map(name => {
      const file = path.join(CONVERT_DIR, name), stat = fs.statSync(file);
      return { file, size: stat.size, at: stat.mtimeMs, temp: /\.(src|tmp)/.test(name) };
    }).sort((a, b) => a.at - b.at);
    let total = files.reduce((sum, item) => sum + item.size, 0);

    for (const item of files) {
      const abandoned = item.temp && Date.now() - item.at > 30 * 60 * 1000;
      if (!abandoned && total <= CACHE_MAX_BYTES) continue;
      if (item.temp && !abandoned) continue;
      try { fs.unlinkSync(item.file); total -= item.size; } catch (err) {}
    }
  } catch (err) {}
}

function downloadToFile(url, file) {
  return new Promise((resolve, reject) => {
    fetch(url, { headers: UA }).then(response => {
      if (!response.ok) return reject(Object.assign(new Error(`the host answered ${response.status}`), { status: response.status }));
      if (/^text\/html/i.test(response.headers.get("content-type") || "")) {
        if (response.body.destroy) response.body.destroy();
        return reject(Object.assign(new Error("the link returned a web page, not a file"), { status: 409 }));
      }
      let received = 0;
      response.body.on("data", chunk => {
        received += chunk.length;
        if (received > SOURCE_MAX_BYTES) response.body.destroy(new Error("the file is too large to convert"));
      });
      pipeline(response.body, fs.createWriteStream(file), err => err ? reject(err) : resolve(received));
    }, reject);
  });
}

async function convert(key, url) {
  fs.mkdirSync(CONVERT_DIR, { recursive: true });
  const source = path.join(CONVERT_DIR, `${key}.src`);

  try {
    const bytes = await downloadToFile(url, source);
    if (!bytes) throw new Error("the host sent an empty file");

    const info = await runFfmpeg(["-i", source]);
    const codecMatch = /Stream #[^\n]*Audio: ([a-z0-9_]+)/i.exec(info.stderr);
    if (!codecMatch) throw new Error("no audio stream found in the file");

    const codec = codecMatch[1].toLowerCase();
    const base = ["-y", "-loglevel", "error", "-i", source, "-vn", "-sn", "-dn", "-map", "0:a:0"];
    const reencode = { ext: ".mp3", args: ["-c:a", "libmp3lame", "-q:a", "0", "-f", "mp3"] };
    let plan = reencode;

    if (codec === "aac") plan = { ext: ".m4a", args: ["-c:a", "copy", "-movflags", "+faststart", "-f", "mp4"] };
    else if (codec === "mp3") plan = { ext: ".mp3", args: ["-c:a", "copy", "-f", "mp3"] };
    else if (/^(alac|flac|pcm_|ape|wavpack|wmalossless|tta|mlp|truehd)/.test(codec)) plan = { ext: ".flac", args: ["-c:a", "flac", "-f", "flac"] };

    let result, out;
    for (const attempt of plan === reencode ? [plan] : [plan, reencode]) {
      const temp = path.join(CONVERT_DIR, `${key}.tmp${attempt.ext}`);
      out = path.join(CONVERT_DIR, key + attempt.ext);
      result = await runFfmpeg([...base, ...attempt.args, temp]);
      if (result.code === 0 && fs.existsSync(temp) && fs.statSync(temp).size > 0) { fs.renameSync(temp, out); break; }
      try { fs.unlinkSync(temp); } catch (err) {}
      out = null;
    }

    if (!out) throw new Error(`ffmpeg could not convert it: ${(result.stderr || "").trim().split("\n").pop()}`);
    console.log(`[media] converted ${url} (${codec}, ${(bytes / 1048576).toFixed(1)}MB)`);
    return out;
  } finally {
    try { fs.unlinkSync(source); } catch (err) {}
    pruneConverted();
  }
}

function converted(url) {
  const key = keyFor(url);
  const ready = findConverted(key);
  if (ready) return Promise.resolve(ready);
  if (!conversions.has(key)) conversions.set(key, convert(key, url).finally(() => conversions.delete(key)));
  return conversions.get(key);
}

async function sendConverted(res, url) {
  let file;
  try {
    file = await converted(url);
  } catch (err) {
    console.error(`[media] converting ${url} failed:`, err.message || err);
    if (ffmpegMissing) console.error("[media] ffmpeg was not found. Install ffmpeg, `npm install ffmpeg-static`, or set FFMPEG_PATH.");
    if (!res.headersSent) res.status(err.status === 409 ? 409 : 502).json({ error: ffmpegMissing ? "ffmpeg-missing" : "conversion-failed" });
    return;
  }

  if (res.destroyed || res.writableEnded) return;
  const now = new Date();
  fs.utimes(file, now, now, () => {});

  res.sendFile(file, {
    dotfiles: "allow", acceptRanges: true,
    headers: { "Content-Type": CONVERTED_TYPES[path.extname(file)] || "audio/mpeg", "Content-Disposition": "inline", "Cache-Control": "private, max-age=3600" }
  }, err => { if (err && !res.headersSent) res.status(500).send("Could not send the converted file."); });
}

/* ------------------------------------------------------------------ piping */
async function pipeMedia(req, res, url, hint) {
  const force = Boolean(req.query.convert);
  if (force || conversions.has(keyFor(url)) || findConverted(keyFor(url))) return sendConverted(res, url);

  const headers = { ...UA };
  if (req.headers.range) headers.Range = req.headers.range;

  const response = await fetch(url, { headers });
  const drop = () => { if (response.body && response.body.destroy) response.body.destroy(); };

  if (!response.ok && response.status !== 206) {
    drop();
    return res.status(response.status === 404 ? 404 : 502).json({ error: "host-refused" });
  }

  const upstream = (response.headers.get("content-type") || "").split(";")[0].trim();
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(response.headers.get("content-disposition") || "");

  // Drive answers with a page for a file that is not shared; dead links do the same
  if (/^text\/html/i.test(upstream)) {
    drop();
    return res.status(409).json({ error: "not-a-file" });
  }

  // hosts label things octet-stream, or call an m4a "audio/mpeg": the name and
  // then the file's own first bytes are trusted over the label
  let type = hint || (named && mimeForName(decodeURIComponent(named[1]))) || mimeForName(url);
  if (!type && /^(audio|video)\//i.test(upstream) && !/mpeg$/i.test(upstream)) type = upstream;
  if (!type) type = await probeType(url);
  if (!type) type = /^(audio|video)\//i.test(upstream) ? upstream : "audio/mpeg";

  if (NEEDS_CONVERSION.test(type)) { drop(); return sendConverted(res, url); }

  res.status(response.status === 206 ? 206 : 200);
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=600");
  ["content-length", "content-range"].forEach(header => {
    const value = response.headers.get(header);
    if (value) res.setHeader(header, value);
  });

  pipeline(response.body, res, () => {});
}

/* ------------------------------------------------------------------ hosts */
const exoshareCache = new Map();

// a share can hold the song several times over; audio first, then a video
async function exoshareFile(shareId, fileId) {
  const cacheKey = shareId + "/" + (fileId || "");
  if (exoshareCache.has(cacheKey)) return exoshareCache.get(cacheKey);

  const response = await fetch(`https://exoshare.org/api/shares/${shareId}`, { headers: { ...UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`exoshare answered ${response.status}`);

  const files = ((await response.json()).files || []).slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const playable = files.filter(file => mimeForName(file.name));
  const pick = (fileId && playable.find(file => file.id === fileId)) ||
    playable.find(file => /\.(mp3|flac|wav|ogg|opus)$/i.test(file.name)) ||
    playable.find(file => !VIDEO_NAME.test(file.name)) || playable[0];
  if (!pick) throw new Error("nothing playable in this exoshare share");

  const found = { url: `https://exoshare.org/api/shares/${shareId}/files/${pick.id}`, type: mimeForName(pick.name) };
  exoshareCache.set(cacheKey, found);
  return found;
}

// imgur.gg has moved its files between hosts (i., then b.); m. only answers its own page
function findImgurFile(html, id) {
  const flat = String(html).replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");
  const match = flat.match(new RegExp(`https?://(?!m\\.)[a-z0-9]+\\.imgur\\.gg/${id}-[^"'\\\\\\s<>]*?\\.(?:mp3|m4a|wav|flac|ogg|opus|aac|mp4|mov|webm|aiff|alac)`, "i"));
  return match ? match[0] : null;
}

module.exports = function mountMedia(app, { isDirectFileHost, directFileLink, getDriveId }) {
  const imgurMediaCache = new Map();

  async function imgurFile(id, link) {
    if (imgurMediaCache.has(id)) return imgurMediaCache.get(id);
    let url = /[a-z0-9]\.imgur\.gg\//i.test(link) ? findImgurFile(link, id) : null;

    if (!url) {
      const response = await fetch(`https://imgur.gg/f/${id}`, { headers: UA });
      if (!response.ok) throw new Error(`imgur.gg answered ${response.status}`);
      url = findImgurFile(await response.text(), id);
    }
    if (!url) throw new Error("no file found on the imgur.gg page");

    imgurMediaCache.set(id, url);
    return url;
  }

  // the tracker's link -> where the file itself is, or null for a host not known here
  async function resolve(link) {
    let url;
    try { url = new URL(link); } catch (err) { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const on = name => host === name || host.endsWith("." + name);
    let m;

    if (on("pillows.su") && (m = link.match(/[a-f0-9]{32}/i))) return { url: `https://api.pillows.su/api/get/${m[0]}`, forget() {} };

    const driveId = getDriveId(link);
    if (driveId) return { url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t` };

    if (on("exoshare.org")) {
      const one = link.match(/exoshare\.org\/api\/shares\/([A-Za-z0-9_-]+)\/files\/([A-Za-z0-9-]+)/i);
      const share = one || link.match(/exoshare\.org\/(?:share|s)\/([A-Za-z0-9_-]+)/i);
      if (!share) return null;
      const file = await exoshareFile(share[1], one ? one[2] : "");
      return { ...file, forget: () => exoshareCache.delete(share[1] + "/" + (one ? one[2] : "")) };
    }

    if (on("pixeldrain.com") && (m = link.match(/pixeldrain\.com\/(?:u|api\/file)\/([A-Za-z0-9]+)/i))) return { url: `https://pixeldrain.com/api/file/${m[1]}` };

    if (on("imgur.gg")) {
      m = link.match(/imgur\.gg\/f\/([A-Za-z0-9]+)/i) || link.match(/[a-z0-9]\.imgur\.gg\/([A-Za-z0-9]+)-/i);
      if (m) { const id = m[1]; const file = await imgurFile(id, link); return { url: file, type: mimeForName(file), forget: () => imgurMediaCache.delete(id) }; }
    }

    const direct = directFileLink(link);
    if (isDirectFileHost(direct)) return { url: direct, type: mimeForName(direct) };

    return null;
  }

  app.get("/media", async (req, res) => {
    const link = String(req.query.u || "").trim();
    let target;

    try {
      target = await resolve(link);
    } catch (err) {
      console.error("[media] could not resolve", link, "-", err.message || err);
      return res.status(502).json({ error: "unresolved" });
    }
    if (!target) return res.status(400).json({ error: "host-not-allowed" });

    try {
      await pipeMedia(req, res, target.url, target.type);
    } catch (err) {
      console.error("[media]", link, "-", err.message || err);
      if (target.forget) target.forget();
      if (!res.headersSent) res.status(502).json({ error: "failed" });
    }
  });
};
