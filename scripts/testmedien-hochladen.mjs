// Legt für jeden Moment im Seed eine Datei im lokalen Medien-Speicher ab.
//
// Warum es das braucht: `supabase/seed.sql` legt Zeilen an, lädt aber bewusst
// nichts hoch — und `supabase db reset` leert den Bucket mit. Ohne diesen
// Schritt zeigen Übersicht, Player und Karte nach jedem Reset leere Kacheln,
// und die Lese-URLs antworten mit 404. Das ist keine Panne, sondern der
// fehlende zweite Halbschritt, den bisher jede Session von Hand nachgeholt hat.
//
// Erzeugt keine echten Fotos, sondern je Moment eine eigene Farbfläche mit
// Ort und Uhrzeit darauf. Das reicht für alles, was lokal zu prüfen ist, und
// hat einen Vorteil gegenüber demselben Platzhalterbild für alle: auf einem
// Screenshot ist sofort zu sehen, WELCHER Moment gerade gezeigt wird.
//
//   node scripts/testmedien-hochladen.mjs
//
// Braucht einen laufenden lokalen Stack (`npx supabase start`) und ffmpeg.
// Mehrfaches Ausführen ist harmlos (Upsert).

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const ausfuehren = promisify(execFile);

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Der Service-Key des LOKALEN Stacks. Er ist in jeder Supabase-CLI-Installation
// derselbe und gehört zu keiner echten Umgebung — dieses Skript läuft
// ausschliesslich gegen 127.0.0.1.
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const BUCKET = 'media';
const SCHRIFT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

// Eine feste Farbe je Moment: gleicher Moment, gleiche Farbe, auch nach einem
// Reset. Nur der Farbton wandert, Sättigung und Helligkeit bleiben — sonst
// entstehen Flächen, auf denen die weisse Schrift nicht mehr lesbar ist.
function farbeFuer(id) {
  let summe = 0;
  for (const zeichen of id) summe = (summe * 31 + zeichen.charCodeAt(0)) % 360;
  const [r, g, b] = hslNachRgb(summe, 0.45, 0.38);
  return `0x${[r, g, b].map((k) => k.toString(16).padStart(2, '0')).join('')}`;
}

function hslNachRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((k) => Math.round((k + m) * 255));
}

// ffmpeg zerlegt den drawtext-Filter selbst weiter: Doppelpunkt trennt
// Optionen, einfache Anführungszeichen begrenzen Werte. Beides muss aus dem
// Text raus, sonst bricht der Aufruf an einer Uhrzeit wie «14:32».
function fuerFfmpeg(text) {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '');
}

async function hole(pfad) {
  const antwort = await fetch(`${API}${pfad}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!antwort.ok) throw new Error(`${pfad} → ${antwort.status} ${await antwort.text()}`);
  return antwort.json();
}

async function lade(schluessel, datei, typ) {
  const koerper = await readFile(datei);
  const antwort = await fetch(`${API}/storage/v1/object/${BUCKET}/${schluessel}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': typ,
      // Ohne Upsert scheitert jeder zweite Lauf mit «Duplicate».
      'x-upsert': 'true',
    },
    body: koerper,
  });
  if (!antwort.ok) throw new Error(`${schluessel} → ${antwort.status} ${await antwort.text()}`);
}

async function bild(ziel, farbe, groesse, beschriftung) {
  const text = fuerFfmpeg(beschriftung);
  await ausfuehren('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${farbe}:s=${groesse}`,
    '-vf', `drawtext=fontfile=${SCHRIFT}:text='${text}':fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2`,
    '-frames:v', '1', ziel,
  ]);
}

async function video(ziel, farbe, sekunden, beschriftung) {
  const text = fuerFfmpeg(beschriftung);
  await ausfuehren('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${farbe}:s=1080x1920:d=${sekunden}:r=30`,
    '-vf', `drawtext=fontfile=${SCHRIFT}:text='${text}':fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2`,
    // yuv420p, sonst spielt AVFoundation die Datei auf iOS nicht ab.
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-t', String(sekunden), ziel,
  ]);
}

const arbeit = await mkdtemp(join(tmpdir(), 'reelive-medien-'));
try {
  const momente = await hole(
    '/rest/v1/posts?select=id,type,storage_key,thumb_key,duration_s,place_name,captured_at&order=captured_at'
  );
  console.log(`${momente.length} Momente im Seed.`);

  let dateien = 0;
  for (const [nummer, m] of momente.entries()) {
    const farbe = farbeFuer(m.id);
    const zeit = new Date(m.captured_at).toISOString().slice(11, 16);
    const beschriftung = `${nummer + 1}. ${m.place_name ?? 'ohne Ort'} ${zeit}`;

    const haupt = join(arbeit, `haupt-${nummer}.${m.type === 'video' ? 'mp4' : 'jpg'}`);
    if (m.type === 'video') await video(haupt, farbe, Math.round(m.duration_s ?? 6), beschriftung);
    else await bild(haupt, farbe, '1200x1800', beschriftung);
    await lade(m.storage_key, haupt, m.type === 'video' ? 'video/mp4' : 'image/jpeg');
    dateien++;

    if (m.thumb_key) {
      const klein = join(arbeit, `klein-${nummer}.jpg`);
      await bild(klein, farbe, '400x600', beschriftung);
      await lade(m.thumb_key, klein, 'image/jpeg');
      dateien++;
    }
    process.stdout.write(`\r${nummer + 1}/${momente.length}`);
  }

  console.log(`\n${dateien} Dateien im Bucket «${BUCKET}».`);
} finally {
  await rm(arbeit, { recursive: true, force: true });
}
