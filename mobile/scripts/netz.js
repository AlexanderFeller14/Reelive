#!/usr/bin/env node
// `npm run netz` — trägt die aktuelle LAN-Adresse in die Konfigurationsdateien
// ein. Aufzurufen nach jedem Wechsel des Netzes (zuhause ↔ Büro), aber NUR
// nötig, wenn Momente hochgeladen oder Recaps geteilt werden sollen: Die App
// selbst findet den Server seit src/lib/supabaseAdresse.ts allein.
//
// Die Regel steckt in netzAdresse.js und ist dort geprüft; hier stehen nur
// Netz und Dateien.
const { execSync } = require('node:child_process');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { mitNeuerAdresse } = require('./netzAdresse');

// en0 ist auf einem MacBook das WLAN, en1 das Kabel über einen Adapter.
function lanAdresse() {
  for (const schnittstelle of ['en0', 'en1']) {
    try {
      const adresse = execSync(`ipconfig getifaddr ${schnittstelle}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (adresse) return adresse;
    } catch {
      // Diese Schnittstelle hat gerade keine Adresse — die nächste probieren.
    }
  }
  return null;
}

const wurzel = join(__dirname, '..', '..');
const dateien = [
  join(wurzel, 'mobile', '.env'),
  join(wurzel, 'supabase', 'functions', '.env'),
];

const adresse = lanAdresse();
if (!adresse) {
  console.error('Keine LAN-Adresse gefunden (en0/en1). Bist du in einem Netz?');
  process.exit(1);
}

console.log(`Aktuelle LAN-Adresse: ${adresse}`);

let geaendert = 0;
for (const datei of dateien) {
  if (!existsSync(datei)) {
    console.log(`  übersprungen (fehlt): ${datei}`);
    continue;
  }
  const vorher = readFileSync(datei, 'utf8');
  const nachher = mitNeuerAdresse(vorher, adresse);
  if (vorher === nachher) {
    console.log(`  schon aktuell: ${datei}`);
    continue;
  }
  writeFileSync(datei, nachher);
  geaendert += 1;
  console.log(`  nachgezogen:   ${datei}`);
}

if (geaendert > 0) {
  // EXPO_PUBLIC_* wird beim Bündeln fest eingesetzt; ein blosses Neuladen der
  // App holt sonst denselben alten Wert.
  console.log('\nMetro neu starten (npx expo start --lan --clear),');
  console.log('und `supabase functions serve` ebenfalls, falls es läuft.');
}
