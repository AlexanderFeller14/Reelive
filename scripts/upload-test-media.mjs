// Creates a file in the local media storage for each moment in the seed.
//
// Why it's needed: `supabase/seed.sql` creates rows but intentionally uploads
// nothing, and `supabase db reset` empties the bucket with it. Without this step,
// overview, player, and map show empty tiles after each reset, and read URLs
// respond with 404. This is not a bug but the missing second half-step that
// each session previously completed manually.
//
// The revealed and archived trips (Lissabon, Sardinien) get REAL photos from
// Unsplash, mapped per moment below, so the recap can be judged the way it
// will actually look: the mosaic, the hero, and the show only reveal their
// balance on photographs, never on colour cards. Video moments become a slow
// vertical pan rendered from the same photo (a Ken Burns cut), which plays in
// the player like real footage without needing a video source. The sealed
// Norway trip keeps the labelled colour cards: nobody can see it before a
// reveal, and the label-per-moment property is still useful in screenshots.
//
// The script also upserts the densification moments 016 to 021 of the Lisbon
// trip (the same rows seed.sql now carries), so a stack that predates that
// seed change picks them up WITHOUT a `db reset`, which would wipe locally
// created trips and accounts.
//
//   node scripts/upload-test-media.mjs
//
// Requires a running local stack (`npx supabase start`) and ffmpeg. Network
// access to images.unsplash.com is expected; any failed download falls back
// to picsum.photos (seeded by the moment id, so the picture is stable across
// runs), and only if that fails too does the moment keep a colour card.
// Running multiple times is harmless (upsert everywhere).

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The service key of the LOCAL stack. It is the same in every Supabase CLI
// installation and belongs to no real environment; this script runs exclusively
// against 127.0.0.1.
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const BUCKET = 'media';
const FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

const LISBON_TRIP = 'aaaaaaaa-0000-4000-8000-000000000002';

// ---------------------------------------------------------------------------
// The densification moments, identical to the block seed.sql carries. The
// storage keys are written in the real layout ('trips/<trip>/<post>.<ext>')
// right away instead of the seed's readable interim form, because this insert
// bypasses the seed's normalising UPDATE; a key that deviates from the
// derivation in media-urls/keys.ts would make the function silently skip the
// moment (its storage_key tripwire), which is exactly the failure this
// comment exists to prevent.
// ---------------------------------------------------------------------------
const post = (n, author, type, ext, duration, caption, capturedAt, lat, lng, place, createdAt) => {
  const id = `bbbbbbbb-0000-4000-8000-0000000000${n}`;
  return {
    id, trip_id: LISBON_TRIP, author_id: author, type, media_ext: ext,
    storage_key: `trips/${LISBON_TRIP}/${id}.${ext}`,
    thumb_key: `trips/${LISBON_TRIP}/${id}_t.jpg`,
    duration_s: duration, caption, captured_at: capturedAt, captured_tz: 'Europe/Lisbon',
    lat, lng, place_name: place, upload_status: 'uploaded', created_at: createdAt,
  };
};
const LEA = '11111111-1111-4111-8111-111111111111';
const MIRA = '33333333-3333-4333-8333-333333333333';
const JONAS = '44444444-4444-4444-8444-444444444444';
const DENSIFICATION = [
  post('16', MIRA, 'photo', 'jpg', null, 'Ginjinha, klebrig aber gut', '2026-05-09 11:35:00+01', 38.7146, -9.1394, 'Rossio', '2026-05-09 11:41:00+01'),
  post('17', JONAS, 'photo', 'jpg', null, 'Jerónimos, Schlange bis raus', '2026-05-09 12:55:00+01', 38.6979, -9.2063, 'Belém', '2026-05-09 13:10:00+01'),
  post('18', LEA, 'photo', 'jpg', null, 'Regaleira, Brunnen abwärts', '2026-05-10 10:30:00+01', 38.7963, -9.3958, 'Quinta da Regaleira', '2026-05-10 10:42:00+01'),
  post('19', MIRA, 'photo', 'jpg', null, null, '2026-05-10 11:45:00+01', 38.7972, -9.3904, 'Sintra', '2026-05-10 12:01:00+01'),
  post('20', JONAS, 'video', 'mp4', 7.5, 'Bus zurück, Kurven ohne Ende', '2026-05-10 15:10:00+01', 38.7876, -9.3904, 'Sintra', '2026-05-10 15:18:00+01'),
  post('21', LEA, 'photo', 'jpg', null, 'Abendlicht am Cais das Colunas', '2026-05-10 19:30:00+01', 38.7075, -9.1364, 'Cais das Colunas', '2026-05-10 19:36:00+01'),
];

// ---------------------------------------------------------------------------
// One curated Unsplash photo per moment of the two visible trips. Curation is
// best effort (a travel photo that fits the caption's mood, not a documentary
// match); a dead id is not an error, the download falls back per moment.
// Moments without an entry (all of sealed Norway) keep the colour cards.
// ---------------------------------------------------------------------------
const REAL_PHOTOS = {
  // Lissabon, day 1
  'bbbbbbbb-0000-4000-8000-000000000001': 'photo-1516483638261-f4dbaf036963',
  'bbbbbbbb-0000-4000-8000-000000000002': 'photo-1467269204594-9661b134dd2b',
  'bbbbbbbb-0000-4000-8000-000000000003': 'photo-1502602898657-3e91760cbb34',
  // day 2
  'bbbbbbbb-0000-4000-8000-000000000004': 'photo-1509440159596-0249088772ff',
  'bbbbbbbb-0000-4000-8000-000000000016': 'photo-1414235077428-338989a2e8c0',
  'bbbbbbbb-0000-4000-8000-000000000017': 'photo-1523906834658-6e24ef2386f9',
  'bbbbbbbb-0000-4000-8000-000000000013': 'photo-1499856871958-5b9627545d1a',
  'bbbbbbbb-0000-4000-8000-000000000005': 'photo-1513635269975-59663e0ac1ad',
  'bbbbbbbb-0000-4000-8000-000000000006': 'photo-1472214103451-9374bd1c798e',
  // day 3
  'bbbbbbbb-0000-4000-8000-000000000007': 'photo-1474487548417-781cb71495f3',
  'bbbbbbbb-0000-4000-8000-000000000018': 'photo-1441974231531-c6227db76b6e',
  'bbbbbbbb-0000-4000-8000-000000000019': 'photo-1470071459604-3b5ec3a7fe05',
  'bbbbbbbb-0000-4000-8000-000000000008': 'photo-1526392060635-9d6019884377',
  'bbbbbbbb-0000-4000-8000-000000000020': 'photo-1506905925346-21bda4d32df4',
  'bbbbbbbb-0000-4000-8000-000000000009': 'photo-1507525428034-b723cf961d3e',
  'bbbbbbbb-0000-4000-8000-000000000021': 'photo-1500530855697-b586d89ba3ee',
  'bbbbbbbb-0000-4000-8000-000000000014': 'photo-1519681393784-d120267933ba',
  // day 4
  'bbbbbbbb-0000-4000-8000-000000000010': 'photo-1504674900247-0877df9cc836',
  'bbbbbbbb-0000-4000-8000-000000000015': 'photo-1512453979798-5ea266f8880c',
  'bbbbbbbb-0000-4000-8000-000000000011': 'photo-1493246507139-91e8fad9978e',
  // day 5
  'bbbbbbbb-0000-4000-8000-000000000012': 'photo-1436491865332-7a61a109cc05',
  // Sardinien
  'dddddddd-0000-4000-8000-000000000001': 'photo-1469854523086-cc02fe5d8800',
  'dddddddd-0000-4000-8000-000000000002': 'photo-1519046904884-53103b34b206',
  'dddddddd-0000-4000-8000-000000000003': 'photo-1501854140801-50d01698950b',
  'dddddddd-0000-4000-8000-000000000004': 'photo-1476514525535-07fb3b4ae5f1',
  'dddddddd-0000-4000-8000-000000000005': 'photo-1502082553048-f009c37129b9',
};

// Portrait 3:4 like a phone photo. The video source is loaded 20% larger than
// the 9:16 output so the pan has room to travel.
const MEDIUM = { w: 1080, h: 1440 };
const THUMB = { w: 480, h: 640 };
const VIDEO_SRC = { w: 1296, h: 2304 };
const VIDEO_OUT = { w: 1080, h: 1920 };

function colorForId(id) {
  let sum = 0;
  for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) % 360;
  const [r, g, b] = hslToRgb(sum, 0.45, 0.38);
  return `0x${[r, g, b].map((k) => k.toString(16).padStart(2, '0')).join('')}`;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((k) => Math.round((k + m) * 255));
}

// ffmpeg further parses the drawtext filter itself: colon separates options,
// single quotes delimit values. Both must be removed from the text, otherwise
// the call breaks at a time like "14:32".
function escapeForFfmpeg(text) {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '');
}

async function fetchPath(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
  return response.json();
}

async function upsertDensification() {
  const response = await fetch(`${API}/rest/v1/posts?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      // Existing rows stay untouched: a stack that already ran the new
      // seed.sql (or this script) must not have its rows rewritten.
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify(DENSIFICATION),
  });
  if (!response.ok) throw new Error(`densification upsert → ${response.status} ${await response.text()}`);
}

async function uploadFile(key, file, contentType) {
  const body = await readFile(file);
  const response = await fetch(`${API}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType,
      // Without upsert, every second run fails with 'Duplicate'.
      'x-upsert': 'true',
    },
    body,
  });
  if (!response.ok) throw new Error(`${key} → ${response.status} ${await response.text()}`);
}

// fm=jpg pins the format: with auto=format Unsplash may answer webp, and the
// upload would then carry image/jpeg over webp bytes, which iOS refuses.
let fallbackCount = 0;
async function downloadPhoto(destination, unsplashId, size, momentId) {
  const sources = [
    `https://images.unsplash.com/${unsplashId}?fm=jpg&w=${size.w}&h=${size.h}&fit=crop&q=80`,
    // Seeded by the moment id: the fallback picture is stable across runs.
    `https://picsum.photos/seed/${momentId}/${size.w}/${size.h}`,
  ];
  for (const [attempt, url] of sources.entries()) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
      if (attempt > 0) fallbackCount++;
      return true;
    } catch {
      // Network hiccup: try the next source, the colour card remains last.
    }
  }
  return false;
}

async function createImage(destination, color, size, caption) {
  const text = escapeForFfmpeg(caption);
  await execute('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`,
    '-vf', `drawtext=fontfile=${FONT}:text='${text}':fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2`,
    '-frames:v', '1', destination,
  ]);
}

async function createVideo(destination, color, seconds, caption) {
  const text = escapeForFfmpeg(caption);
  await execute('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=1080x1920:d=${seconds}:r=30`,
    '-vf', `drawtext=fontfile=${FONT}:text='${text}':fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2`,
    // yuv420p, otherwise AVFoundation won't play the file on iOS.
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-t', String(seconds), destination,
  ]);
}

// A slow top-to-bottom pan over the oversized still: crop evaluates its
// position expressions per frame, which is sturdier than zoompan's
// notoriously fiddly per-frame accounting. 384 spare pixels over the clip's
// length give a drift of a few dozen pixels per second, unhurried on a phone.
async function createPanVideo(destination, sourceImage, seconds) {
  await execute('ffmpeg', [
    '-y', '-loop', '1', '-i', sourceImage,
    '-vf', `crop=${VIDEO_OUT.w}:${VIDEO_OUT.h}:(iw-ow)/2:(ih-oh)*t/${seconds}`,
    '-t', String(seconds), '-r', '30',
    // yuv420p, otherwise AVFoundation won't play the file on iOS.
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', destination,
  ]);
}

// The video's thumbnail is its opening frame, so the tile and the first
// played frame agree, the same promise the app itself keeps via
// expo-video-thumbnails.
async function createVideoThumb(destination, sourceImage) {
  await execute('ffmpeg', [
    '-y', '-i', sourceImage,
    '-vf', `crop=${VIDEO_OUT.w}:${VIDEO_OUT.h}:(iw-ow)/2:0,scale=${THUMB.w}:-2`,
    '-frames:v', '1', destination,
  ]);
}

const workDir = await mkdtemp(join(tmpdir(), 'reelive-media-'));
try {
  await upsertDensification();

  const moments = await fetchPath(
    '/rest/v1/posts?select=id,type,storage_key,thumb_key,duration_s,place_name,captured_at&order=captured_at'
  );
  console.log(`${moments.length} moments in seed.`);

  let fileCount = 0;
  let realCount = 0;
  for (const [index, m] of moments.entries()) {
    const unsplashId = REAL_PHOTOS[m.id];
    const main = join(workDir, `main-${index}.${m.type === 'video' ? 'mp4' : 'jpg'}`);
    const thumb = join(workDir, `thumb-${index}.jpg`);
    let real = false;

    if (unsplashId) {
      if (m.type === 'video') {
        const still = join(workDir, `still-${index}.jpg`);
        const seconds = Math.round((m.duration_s ?? 6) * 10) / 10;
        real = await downloadPhoto(still, unsplashId, VIDEO_SRC, m.id);
        if (real) {
          await createPanVideo(main, still, seconds);
          await createVideoThumb(thumb, still);
        }
      } else {
        real = await downloadPhoto(main, unsplashId, MEDIUM, m.id)
          && await downloadPhoto(thumb, unsplashId, THUMB, m.id);
      }
    }

    if (!real) {
      const color = colorForId(m.id);
      const time = new Date(m.captured_at).toISOString().slice(11, 16);
      const caption = `${index + 1}. ${m.place_name ?? 'no location'} ${time}`;
      if (m.type === 'video') await createVideo(main, color, Math.round(m.duration_s ?? 6), caption);
      else await createImage(main, color, '1200x1800', caption);
      if (m.thumb_key) await createImage(thumb, color, '400x600', caption);
    } else {
      realCount++;
    }

    await uploadFile(m.storage_key, main, m.type === 'video' ? 'video/mp4' : 'image/jpeg');
    fileCount++;
    if (m.thumb_key) {
      await uploadFile(m.thumb_key, thumb, 'image/jpeg');
      fileCount++;
    }
    process.stdout.write(`\r${index + 1}/${moments.length}`);
  }

  console.log(`\n${fileCount} files in bucket '${BUCKET}', ${realCount} moments with real photos.`);
  if (fallbackCount > 0) {
    console.log(`${fallbackCount} downloads fell back to picsum (dead or unreachable Unsplash id).`);
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
