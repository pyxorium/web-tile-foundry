// The importer's WebM writer (v0.35.0, src/tile-types/mixtape/webm.js): the
// file's structure read back element by element. Playing it is checked in
// Chromium by the browser check (claude/mixtape-tools/), with a real FLAC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { muxOpusWebm, makeOpusHead, preSkipOf, vint, readElements, readUint, readFloat, ID } from "../src/tile-types/mixtape/webm.js";

// 12.34 s of 20 ms "packets" (stand-in bytes), timestamps in microseconds.
function packets(seconds = 12.34, start = 0) {
  const out = [];
  for (let t = 0; t < seconds * 1e6; t += 20000) out.push({ data: Uint8Array.from([0xfc, t % 251, 7]), timestampUs: start + t });
  return out;
}

const child = (bytes, parent, id) => readElements(bytes, parent.dataStart, parent.dataStart + parent.size).filter((e) => e.id === id);
const one = (bytes, parent, id) => {
  const list = child(bytes, parent, id);
  assert.equal(list.length, 1, `one ${id.toString(16)}`);
  return list[0];
};
const text = (bytes, e) => new TextDecoder().decode(bytes.subarray(e.dataStart, e.dataStart + e.size));

test("EBML sizes: shortest form, all-ones avoided, a forced width", () => {
  assert.deepEqual([...vint(0)], [0x80]);
  assert.deepEqual([...vint(126)], [0xfe]);
  assert.deepEqual([...vint(127)], [0x40, 0x7f], "0xff alone would mean 'unknown size'");
  assert.deepEqual([...vint(5, 8)], [1, 0, 0, 0, 0, 0, 0, 5]);
  assert.throws(() => vint(-1));
});

test("OpusHead: made when the encoder gives none; its pre-skip read back", () => {
  const head = makeOpusHead({ channels: 2, preSkip: 312, inputRate: 48000 });
  assert.equal(head.length, 19);
  assert.equal(new TextDecoder().decode(head.subarray(0, 8)), "OpusHead");
  assert.equal(preSkipOf(head), 312);
  assert.equal(preSkipOf(new Uint8Array(19)), null);
});

test("the file: header, Info with the duration, an Opus track, clusters every 5 s, cues and seek head that point right", () => {
  const ps = packets(12.34, 5000);
  const bytes = muxOpusWebm({ packets: ps, opusHead: makeOpusHead({ preSkip: 312 }), channels: 2, durationMs: 12340 });
  const top = readElements(bytes);
  assert.deepEqual(top.map((e) => e.id), [ID.EBML, ID.Segment]);
  assert.equal(text(bytes, one(bytes, top[0], ID.DocType)), "webm");
  assert.equal(readUint(bytes, one(bytes, top[0], ID.DocTypeVersion)), 4);

  const seg = top[1];
  const parts = readElements(bytes, seg.dataStart, seg.dataStart + seg.size);
  assert.deepEqual(parts.map((e) => e.id), [ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cluster, ID.Cluster, ID.Cues]);

  const info = parts[1];
  assert.equal(readUint(bytes, one(bytes, info, ID.TimestampScale)), 1000000);
  assert.equal(readFloat(bytes, one(bytes, info, ID.Duration)), 12340);

  const entry = one(bytes, parts[2], ID.TrackEntry);
  assert.equal(text(bytes, one(bytes, entry, ID.CodecID)), "A_OPUS");
  assert.equal(readUint(bytes, one(bytes, entry, ID.TrackType)), 2);
  assert.equal(readUint(bytes, one(bytes, entry, ID.CodecDelay)), 6500000, "312 samples at 48 kHz");
  assert.equal(readUint(bytes, one(bytes, entry, ID.SeekPreRoll)), 80000000);
  const priv = one(bytes, entry, ID.CodecPrivate);
  assert.equal(preSkipOf(bytes.subarray(priv.dataStart, priv.dataStart + priv.size)), 312);
  const audio = one(bytes, entry, ID.Audio);
  assert.equal(readFloat(bytes, one(bytes, audio, ID.SamplingFrequency)), 48000);
  assert.equal(readUint(bytes, one(bytes, audio, ID.Channels)), 2);

  // Every packet is in a block, in order, timed from the first packet.
  const clusters = parts.filter((e) => e.id === ID.Cluster);
  const times = clusters.map((c) => readUint(bytes, one(bytes, c, ID.Timestamp)));
  assert.deepEqual(times, [0, 5000, 10000]);
  let n = 0;
  clusters.forEach((c, k) => {
    for (const b of child(bytes, c, ID.SimpleBlock)) {
      const d = bytes.subarray(b.dataStart, b.dataStart + b.size);
      assert.equal(d[0], 0x81, "track 1");
      const rel = new DataView(d.buffer, d.byteOffset + 1, 2).getInt16(0);
      assert.equal(times[k] + rel, Math.round((ps[n].timestampUs - 5000) / 1000));
      assert.equal(d[3] & 0x80, 0x80, "keyframe");
      assert.deepEqual([...d.subarray(4)], [...ps[n].data]);
      n++;
    }
  });
  assert.equal(n, ps.length);

  // Positions are counted from the start of the Segment's contents.
  const at = (e) => e.start - seg.dataStart;
  const cues = child(bytes, parts.at(-1), ID.CuePoint);
  assert.equal(cues.length, 3);
  cues.forEach((cp, k) => {
    assert.equal(readUint(bytes, one(bytes, cp, ID.CueTime)), times[k]);
    const pos = one(bytes, cp, ID.CueTrackPositions);
    assert.equal(readUint(bytes, one(bytes, pos, ID.CueClusterPosition)), at(clusters[k]));
  });
  const seeks = child(bytes, parts[0], ID.Seek).map((s) => {
    const id = one(bytes, s, ID.SeekID);
    return [readUint(bytes, id), readUint(bytes, one(bytes, s, ID.SeekPosition))];
  });
  assert.deepEqual(seeks, [[ID.Info, at(parts[1])], [ID.Tracks, at(parts[2])], [ID.Cues, at(parts.at(-1))]]);
});

test("a missing or odd OpusHead is replaced; mono; nothing to write is an error", () => {
  const bytes = muxOpusWebm({ packets: packets(1), opusHead: new Uint8Array([1, 2, 3]), channels: 1, durationMs: 1000 });
  const seg = readElements(bytes)[1];
  const tracks = readElements(bytes, seg.dataStart, seg.dataStart + seg.size).find((e) => e.id === ID.Tracks);
  const entry = one(bytes, tracks, ID.TrackEntry);
  const priv = one(bytes, entry, ID.CodecPrivate);
  const head = bytes.subarray(priv.dataStart, priv.dataStart + priv.size);
  assert.equal(preSkipOf(head), 312);
  assert.equal(head[9], 1, "mono");
  assert.throws(() => muxOpusWebm({ packets: [], durationMs: 1 }), /no encoded audio/);
  assert.throws(() => muxOpusWebm({ packets: packets(1), channels: 6, durationMs: 1000 }), /mono or stereo/);
});
