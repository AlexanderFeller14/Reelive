// Creates a file in the local media storage for each moment in the seed.
//
// Why it's needed: `supabase/seed.sql` creates rows but intentionally uploads
// nothing, and `supabase db reset` empties the bucket with it. Without this step,
// overview, player, and map show empty tiles after each reset, and read URLs
// respond with 404. This is not a bug but the missing second half-step that
// each session previously completed manually.
//
// Does not create real photos, but for each moment a separate color surface
// with location and time printed on it. This is sufficient for everything to
// check locally, and has an advantage over using the same placeholder image for
// all: in a screenshot it's immediately clear which moment is being shown.
//
//   node scripts/upload-test-media.mjs
//
// Requires a running local stack (`npx supabase start`) and ffmpeg.
// Running multiple times is harmless (upsert).

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

// A fixed color per moment: same moment, same color, even after reset. Only the
// hue changes, saturation and lightness remain constant, otherwise surfaces
// appear where white text is no longer readable.
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

const workDir = await mkdtemp(join(tmpdir(), 'reelive-media-'));
try {
  const moments = await fetchPath(
    '/rest/v1/posts?select=id,type,storage_key,thumb_key,duration_s,place_name,captured_at&order=captured_at'
  );
  console.log(`${moments.length} moments in seed.`);

  let fileCount = 0;
  for (const [index, m] of moments.entries()) {
    const color = colorForId(m.id);
    const time = new Date(m.captured_at).toISOString().slice(11, 16);
    const caption = `${index + 1}. ${m.place_name ?? 'no location'} ${time}`;

    const main = join(workDir, `main-${index}.${m.type === 'video' ? 'mp4' : 'jpg'}`);
    if (m.type === 'video') await createVideo(main, color, Math.round(m.duration_s ?? 6), caption);
    else await createImage(main, color, '1200x1800', caption);
    await uploadFile(m.storage_key, main, m.type === 'video' ? 'video/mp4' : 'image/jpeg');
    fileCount++;

    if (m.thumb_key) {
      const thumb = join(workDir, `thumb-${index}.jpg`);
      await createImage(thumb, color, '400x600', caption);
      await uploadFile(m.thumb_key, thumb, 'image/jpeg');
      fileCount++;
    }
    process.stdout.write(`\r${index + 1}/${moments.length}`);
  }

  console.log(`\n${fileCount} files in bucket '${BUCKET}'.`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
