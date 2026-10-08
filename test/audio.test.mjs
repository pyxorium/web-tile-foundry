// Audio for tile types (stage 2 of the mixtape plan): MP3 files, size budgets,
// the tracks input, the encoder and its worker pool, converting, and big uploads.
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { contentTypeFor, makeFile } from "../src/core/fileset.js";
import {
  checkTileType, checkInputs, trackProblems, maxBytesFor, formatDuration,
  DEFAULT_MAX_TILE_BYTES, MAX_TILE_BYTES_CAP, INPUT_KINDS,
} from "../src/core/contract.js";
import { buildTile } from "../src/core/build.js";
import { TILE_CSP_META } from "../src/core/policy.js";
import { scanMp3, joinMp3, cutSilence, isTapeFormat, TAPE_FORMAT } from "../src/core/audio/mp3.js";
import { createEncoderPool, defaultPoolSize } from "../src/core/audio/pool.js";
import { convertSong, convertPcm, makeSilence, rmsDb } from "../src/core/audio/convert.js";
import { publishTile, isTooLarge, XrpcError } from "../src/core/publish.js";
import { rawCid } from "../src/core/cid.js";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/audio/${name}`, import.meta.url)));
const TONE_A = fixture("tone-a-96k-32k.mp3");
const TONE_B = fixture("tone-b-96k-32k.mp3");
const TONE_128 = fixture("tone-128k-32k.mp3");
const TONE_VBR = fixture("tone-vbr-44k.mp3");

function typeWith(inputs, extra = {}) {
  return { id: "test-type", version: 1, title: "Test", summary: "Test", inputs, defaults: () => ({}), build: async () => ({}), ...extra };
}

// The encoder exactly as the worker loads it: lamejs (unmodified) plus encode-core.js.
function loadEncoder() {
  const ctx = vm.createContext({ console, Math, Int16Array, Int8Array, Uint8Array, Float32Array });
  vm.runInContext(readFileSync(new URL("../public/vendor/lamejs/lame.min.js", import.meta.url), "utf8"), ctx);
  vm.runInContext(readFileSync(new URL("../public/audio/encode-core.js", import.meta.url), "utf8"), ctx);
  return { lamejs: ctx.lamejs, core: ctx.FoundryEncode };
}

function sine(seconds, freq, amp, rate = 44100) {
  const n = Math.round(seconds * rate);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = right[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return { left, right, rate, seconds };
}

// ---- files and size budgets ------------------------------------------------------

test(".mp3 files have one fixed type", () => {
  assert.equal(contentTypeFor("/tracks/a1.mp3"), "audio/mpeg");
  assert.equal(makeFile("/tracks/b2.MP3", TONE_A).contentType, "audio/mpeg");
});

test("a type may raise its size budget, up to the core's cap", () => {
  assert.equal(maxBytesFor(typeWith([])), DEFAULT_MAX_TILE_BYTES);
  assert.equal(maxBytesFor(typeWith([], { maxBytes: 45 * 1024 * 1024 })), 45 * 1024 * 1024);
  checkTileType(typeWith([], { maxBytes: MAX_TILE_BYTES_CAP }));
  assert.throws(() => checkTileType(typeWith([], { maxBytes: MAX_TILE_BYTES_CAP + 1 })), /maxBytes/);
  assert.throws(() => checkTileType(typeWith([], { maxBytes: 1.5 })), /maxBytes/);
  assert.throws(() => checkTileType(typeWith([], { maxBytes: 0 })), /maxBytes/);
});

test("buildTile keeps to the type's budget", async () => {
  const page = `<!doctype html><html><head>${TILE_CSP_META}</head><body>hi</body></html>`;
  const big = new Uint8Array(6 * 1024 * 1024);
  const build = async () => ({ name: "Big", files: [makeFile("/", page), makeFile("/tracks/a1.mp3", big)] });
  await assert.rejects(buildTile(typeWith([], { build }), {}), /6\.0 MB; a Test tile can be up to 5\.0 MB/);
  const ok = await buildTile(typeWith([], { build, maxBytes: 45 * 1024 * 1024 }), {});
  assert.ok(ok.totalBytes > 6 * 1024 * 1024);
});

// ---- the tracks input ---------------------------------------------------------------

const ready = (id, side, seconds, extra = {}) => ({ id, title: `Song ${id}`, side, seconds, status: "ready", bytes: new Uint8Array([1, 2, 3]), ...extra });

test("tracks is a known kind, and its options are checked", () => {
  assert.ok(INPUT_KINDS.includes("tracks"));
  checkTileType(typeWith([{ key: "t", kind: "tracks", sides: ["A", "B"], maxSecondsPerSide: 1800, maxTracks: 30, transitions: true, picker: { mount() {} } }]));
  checkTileType(typeWith([{ key: "t", kind: "tracks" }]));
  assert.throws(() => checkTileType(typeWith([{ key: "t", kind: "tracks", sides: [] }])), /sides/);
  assert.throws(() => checkTileType(typeWith([{ key: "t", kind: "tracks", sides: ["A", "A"] }])), /sides/);
  assert.throws(() => checkTileType(typeWith([{ key: "t", kind: "tracks", maxSecondsPerSide: -1 }])), /maxSecondsPerSide/);
  assert.throws(() => checkTileType(typeWith([{ key: "t", kind: "tracks", maxTracks: 2.5 }])), /maxTracks/);
  assert.throws(() => checkTileType(typeWith([{ key: "t", kind: "tracks", picker: {} }])), /picker/);
});

test("a song list is ready only when every song is converted and the sides fit", () => {
  const input = { key: "t", kind: "tracks", label: "Songs", required: true, sides: ["A", "B"], maxSecondsPerSide: 600 };
  const type = typeWith([input]);
  assert.deepEqual(checkInputs(type, { t: [ready("1", "A", 300), ready("2", "B", 200, { transition: "pause" })] }), []);

  assert.deepEqual(trackProblems(input, []), ["Add at least one song."]);
  assert.match(trackProblems(input, [ready("1", "A", 300), { id: "2", title: "x", side: "A", status: "converting" }])[0], /1 song is still converting/);
  assert.match(trackProblems(input, [{ id: "1", title: "Jam", side: "A", status: "error", error: "bad file" }]).join(" "), /"Jam" couldn't be converted: bad file/);
  assert.match(trackProblems(input, [ready("1", "A", 400), ready("2", "A", 300)]).join(" "), /Side A is 11:40 long; it holds up to 10:00/);
  assert.match(trackProblems(input, [ready("1", "C", 10)]).join(" "), /unknown side/);
  assert.match(trackProblems(input, [ready("1", "A", 10, { title: "  " })]).join(" "), /needs a title/);
  assert.match(trackProblems(input, [ready("1", "A", 10), ready("1", "B", 10)]).join(" "), /same id/);
  assert.match(trackProblems(input, [ready("1", "A", 10, { transition: "rewind" })]).join(" "), /unknown change/);
  assert.match(trackProblems(input, [ready("1", "A", 10, { bytes: null })]).join(" "), /isn't ready/);
  assert.match(trackProblems({ ...input, maxTracks: 1 }, [ready("1", "A", 10), ready("2", "A", 10)]).join(" "), /up to 1 songs/);
  assert.equal(formatDuration(1800), "30:00");
});

// ---- MP3 files --------------------------------------------------------------------

test("reading an MP3 skips its tags and its length header", () => {
  assert.equal(String.fromCharCode(...TONE_A.subarray(0, 3)), "ID3", "the fixture starts with an ID3 tag");
  const s = scanMp3(TONE_A);
  assert.equal(s.kbps, 96);
  assert.equal(s.rate, 32000);
  assert.equal(s.mono, false);
  assert.ok(isTapeFormat(s));
  assert.ok(Math.abs(s.seconds - 1.044) < 0.04, `about 1.04 s, got ${s.seconds}`);
  // The first frame kept is real audio, not the Xing/Info header.
  const [start] = s.frames[0];
  const info = String.fromCharCode(...TONE_A.subarray(start + 36, start + 40));
  assert.notEqual(info, "Info");
  assert.equal(scanMp3(TONE_VBR).kbps, null, "variable bitrate");
  assert.throws(() => scanMp3(new Uint8Array(1000)), /no MP3 audio/);
});

test("matching files join into one side; others are refused with the reason", () => {
  const j = joinMp3([TONE_A, TONE_B]);
  assert.equal(j.starts.length, 2);
  assert.equal(j.starts[0], 0);
  assert.ok(Math.abs(j.starts[1] - scanMp3(TONE_A).seconds) < 1e-9);
  assert.ok(Math.abs(j.total - (scanMp3(TONE_A).seconds + scanMp3(TONE_B).seconds)) < 1e-9);
  const again = scanMp3(j.bytes);
  assert.equal(again.count, scanMp3(TONE_A).count + scanMp3(TONE_B).count, "no frames lost or added");
  assert.throws(() => joinMp3([TONE_A, TONE_128]), /track 2 is 128 kbps/);
  assert.throws(() => joinMp3([TONE_VBR, TONE_A]), /variable bitrate/);
});

test("silence is cut to whole frames", () => {
  const cut = cutSilence(TONE_B, 0.5);
  const s = scanMp3(cut);
  assert.equal(s.count, Math.round((0.5 * 32000) / 1152));
  assert.throws(() => cutSilence(TONE_A, 5), /only/);
});

// ---- the encoder ---------------------------------------------------------------------

test("the encoder is fed one frame (1152 samples) at a time", () => {
  const { lamejs, core } = loadEncoder();
  assert.equal(core.BLOCK, 1152);
  const sizes = [];
  const Real = lamejs.Mp3Encoder;
  const spy = {
    Mp3Encoder: function (ch, rate, kbps) {
      const enc = new Real(ch, rate, kbps);
      return { encodeBuffer: (l, r) => { sizes.push(l.length); return enc.encodeBuffer(l, r); }, flush: () => enc.flush() };
    },
  };
  const pcm = sine(1, 440, 0.5);
  core.encodePcm(spy, pcm.left, pcm.right, pcm.rate, 96);
  assert.ok(sizes.length > 30);
  assert.ok(Math.max(...sizes) <= 1152, `largest call ${Math.max(...sizes)} samples`);
});

test("encoded songs come out in the tape format, at the right length", () => {
  const { lamejs, core } = loadEncoder();
  const pcm = sine(3, 440, 0.5);
  const mp3 = core.encodePcm(lamejs, pcm.left, pcm.right, pcm.rate, TAPE_FORMAT.kbps);
  const s = scanMp3(mp3);
  assert.ok(isTapeFormat(s), `got ${s.kbps} kbps ${s.rate} Hz`);
  assert.ok(Math.abs(s.seconds - 3) < 0.15, `about 3 s, got ${s.seconds}`);
  assert.ok(mp3.length > 30000 && mp3.length < 42000, `about 96 kbps × 3 s, got ${mp3.length} bytes`);
});

test("fades and loudness", () => {
  const { core } = loadEncoder();
  const pcm = sine(2, 440, 0.5);
  assert.ok(Math.abs(core.rmsDb(pcm.left, pcm.right) - -9.03) < 0.05, "a half-scale sine is about -9 dB");
  assert.ok(Math.abs(rmsDb(pcm.left, pcm.right) - core.rmsDb(pcm.left, pcm.right)) < 1e-9, "page and worker agree");
  core.applyFades(pcm.left, pcm.right, pcm.rate, 0.5, 0.5);
  assert.equal(pcm.left[0], 0);
  assert.ok(Math.abs(pcm.left[pcm.left.length - 1]) < 1e-6);
  const mid = Math.round(pcm.rate * 1);
  assert.ok(Math.abs(pcm.left[mid + Math.round(pcm.rate / 1760)]) > 0.45, "the middle is untouched");
  assert.equal(rmsDb(new Float32Array(10), new Float32Array(10)), -Infinity);
});

// ---- the worker pool -------------------------------------------------------------------

// A stand-in worker: encodes with the real encoder, a little later.
function fakeWorkerFactory({ fail = false, crash = false, log } = {}) {
  const { lamejs, core } = loadEncoder();
  let live = 0;
  return () => {
    const w = {
      terminated: false,
      postMessage(d) {
        live++;
        log.max = Math.max(log.max, live);
        log.jobs.push(d.id);
        setTimeout(() => {
          w.onmessage({ data: { id: d.id, progress: 50 } });
          setTimeout(() => {
            live--;
            if (crash) return w.onerror({ message: "worker crashed" });
            if (fail) return w.onmessage({ data: { id: d.id, error: "could not encode" } });
            core.applyFades(d.left, d.right, d.rate, d.fadeIn, d.fadeOut);
            const inputDb = core.rmsDb(d.left, d.right);
            const mp3 = core.encodePcm(lamejs, d.left, d.right, d.rate, d.kbps);
            w.onmessage({ data: { id: d.id, done: true, mp3, inputDb } });
          }, 5);
        }, 5);
      },
      terminate() { w.terminated = true; log.terminated++; },
    };
    log.made++;
    return w;
  };
}

test("the pool runs several jobs at once, never more than its size, in order", async () => {
  const log = { max: 0, made: 0, jobs: [], terminated: 0 };
  const pool = createEncoderPool({ size: 2, createWorker: fakeWorkerFactory({ log }) });
  const progress = [];
  const jobs = [1, 2, 3, 4, 5].map((k) => {
    const p = sine(0.2, 200 * k, 0.4);
    return pool.encode({ ...p, kbps: 96 }, { onProgress: (x) => progress.push(x) });
  });
  assert.equal(pool.pending(), 5);
  const out = await Promise.all(jobs);
  assert.equal(out.length, 5);
  assert.ok(out.every((r) => r.mp3 instanceof Uint8Array && r.mp3.length > 0));
  assert.equal(log.max, 2, "at most two at a time");
  assert.equal(log.made, 2, "workers are reused");
  assert.deepEqual(log.jobs, [...log.jobs].sort((a, b) => a - b), "first come, first served");
  assert.ok(progress.includes(50));
  assert.equal(pool.pending(), 0);
  pool.dispose();
  assert.equal(log.terminated, 2);
});

test("a failed job is reported, and a crashed worker is replaced", async () => {
  const log = { max: 0, made: 0, jobs: [], terminated: 0 };
  const failing = createEncoderPool({ size: 1, createWorker: fakeWorkerFactory({ fail: true, log }) });
  await assert.rejects(failing.encode({ ...sine(0.1, 300, 0.3), kbps: 96 }), /could not encode/);
  const log2 = { max: 0, made: 0, jobs: [], terminated: 0 };
  const crashing = createEncoderPool({ size: 1, createWorker: fakeWorkerFactory({ crash: true, log: log2 }) });
  await assert.rejects(crashing.encode({ ...sine(0.1, 300, 0.3), kbps: 96 }), /crashed/);
  await assert.rejects(crashing.encode({ ...sine(0.1, 300, 0.3), kbps: 96 }), /crashed/);
  assert.equal(log2.made, 2, "a new worker after the crash");
  assert.equal(defaultPoolSize(8), 4);
  assert.equal(defaultPoolSize(1), 1);
  const closed = createEncoderPool({ size: 1, createWorker: fakeWorkerFactory({ log: { max: 0, made: 0, jobs: [], terminated: 0 } }) });
  closed.dispose();
  await assert.rejects(closed.encode({ ...sine(0.1, 300, 0.3), kbps: 96 }), /closed/);
});

// ---- converting ---------------------------------------------------------------------------

test("converting a song: the result is checked for format and loudness", async () => {
  const log = { max: 0, made: 0, jobs: [], terminated: 0 };
  const pool = createEncoderPool({ size: 2, createWorker: fakeWorkerFactory({ log }) });
  const original = sine(2, 440, 0.5);
  // A stand-in decoder: the original decodes to the tone; the result decodes to `heard`.
  const make = (heardAmp) => async (bytes) => (bytes === SOURCE ? sine(2, 440, 0.5) : sine(2, 440, heardAmp));
  const SOURCE = new Uint8Array([9, 9, 9]);
  const stages = [];
  const good = await convertSong(SOURCE, { pool, decode: make(0.5), onProgress: (s) => stages.push(s) });
  assert.ok(isTapeFormat(scanMp3(good.bytes)));
  assert.ok(Math.abs(good.seconds - 2) < 0.15);
  assert.ok(Math.abs(good.inputDb - rmsDb(original.left, original.right)) < 0.01);
  assert.deepEqual([...new Set(stages)], ["decoding", "encoding", "checking"]);
  // The lab's bug: a valid MP3 that came out near-silent.
  await assert.rejects(convertSong(SOURCE, { pool, decode: make(0.01) }), /much quieter/);
  // A silent song isn't checked for loudness.
  const quiet = await convertSong(SOURCE, { pool, decode: async () => sine(1, 440, 0) });
  assert.equal(quiet.outputDb, null);
  // Fades reach the encoder (the faded song is quieter than the plain one).
  const faded = await convertSong(SOURCE, { pool, fadeIn: 1, fadeOut: 1, decode: make(0.3) });
  assert.ok(faded.inputDb < good.inputDb - 1);
  pool.dispose();
});

test("converting a clip that's already decoded (Zine Scene's sounds)", async () => {
  const log = { max: 0, made: 0, jobs: [], terminated: 0 };
  const pool = createEncoderPool({ size: 1, createWorker: fakeWorkerFactory({ log }) });
  const stages = [];
  const clip = await convertPcm(sine(1.5, 330, 0.5), { pool, fadeIn: 0.3, fadeOut: 0.5, decode: async () => sine(1.5, 330, 0.45), onProgress: (s) => stages.push(s) });
  assert.ok(isTapeFormat(scanMp3(clip.bytes)));
  assert.ok(Math.abs(clip.seconds - 1.5) < 0.15);
  assert.deepEqual([...new Set(stages)], ["encoding", "checking"]);
  await assert.rejects(convertPcm(sine(1, 330, 0.5), { pool, decode: async () => sine(1, 330, 0.01) }), /much quieter/);
  pool.dispose();
});

test("silence between songs is in the tape format and joins with them", async () => {
  const log = { max: 0, made: 0, jobs: [], terminated: 0 };
  const pool = createEncoderPool({ size: 1, createWorker: fakeWorkerFactory({ log }) });
  const SOURCE = new Uint8Array([1]);
  const song = await convertSong(SOURCE, { pool, decode: async () => sine(1, 440, 0.5) });
  const gap = await makeSilence(2, { pool });
  assert.ok(isTapeFormat(scanMp3(gap)));
  assert.ok(Math.abs(scanMp3(gap).seconds - 2) < 0.04);
  const side = joinMp3([song.bytes, gap, song.bytes]);
  assert.ok(Math.abs(side.starts[2] - (song.seconds + scanMp3(gap).seconds)) < 1e-9);
  await makeSilence(1, { pool });
  assert.equal(log.jobs.length, 2, "the silence is encoded once and reused");
  pool.dispose();
});

// ---- publishing big tiles -------------------------------------------------------------

async function bigResult() {
  const page = `<!doctype html><html><head>${TILE_CSP_META}</head><body>tape</body></html>`;
  const song = new Uint8Array(2 * 1024 * 1024).fill(7);
  const files = [makeFile("/", page), makeFile("/tracks/a1.mp3", song)];
  return { name: "Tape", files: await Promise.all(files.map(async (f) => ({ ...f, cid: await rawCid(f.bytes) }))) };
}

test("upload progress counts megabytes", async () => {
  const result = await bigResult();
  const steps = [];
  const records = {};
  const blobs = {};
  const xrpc = async (nsid, { body, contentType, params }) => {
    if (nsid === "com.atproto.repo.uploadBlob") {
      const cid = await rawCid(body);
      blobs[cid] = body;
      return { blob: { ref: { $link: cid }, mimeType: contentType, size: body.length } };
    }
    if (nsid === "com.atproto.repo.createRecord") { records.r = body.record; return { uri: "at://did:plc:x/ing.dasl.masl/3abc", cid: "bafyrecord" }; }
    if (nsid === "com.atproto.repo.getRecord") return { value: records.r };
    throw new Error(nsid);
  };
  await publishTile({ xrpc, fetchBlob: async (cid) => blobs[cid], did: "did:plc:x", result, onStep: (id, s, d) => steps.push({ id, s, d }) });
  const uploads = steps.filter((x) => x.id === "upload" && x.d);
  const last = uploads[uploads.length - 1].d;
  assert.equal(last.bytesTotal, result.files[0].bytes.length + result.files[1].bytes.length);
  assert.equal(last.bytesDone, last.bytesTotal);
  assert.equal(uploads[0].d.bytesDone, 0);
});

test("a file the server finds too large gets a plain explanation", async () => {
  const result = await bigResult();
  const xrpc = async (nsid, { body }) => {
    if (body.length > 1024 * 1024) throw new XrpcError(413, "PayloadTooLarge", "request entity too large");
    return { blob: { ref: { $link: await rawCid(body) }, mimeType: "text/html", size: body.length } };
  };
  await assert.rejects(
    publishTile({ xrpc, fetchBlob: async () => null, did: "did:plc:x", result }),
    /refused \/tracks\/a1\.mp3 \(2\.0 MB\) as too large/
  );
  assert.ok(isTooLarge(new XrpcError(400, "BlobTooLarge", "")));
  assert.ok(!isTooLarge(new XrpcError(400, "InvalidRequest", "bad")));
});
