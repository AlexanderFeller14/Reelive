#!/usr/bin/env node
// `npm run network`, writes the current LAN address into configuration files.
// Call after each network change (home <-> office), but ONLY needed if moments
// are to be uploaded or recaps shared: The app itself finds the server since
// src/lib/supabaseAddress.ts on its own.
//
// The rule is in networkAddress.js and verified there; here are only
// network and files.
const { execSync } = require('node:child_process');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { withNewAddress } = require('./networkAddress');

// en0 is WiFi on a MacBook, en1 is Ethernet via adapter.
function lanAddress() {
  for (const iface of ['en0', 'en1']) {
    try {
      const address = execSync(`ipconfig getifaddr ${iface}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (address) return address;
    } catch {
      // This interface has no address right now, try the next.
    }
  }
  return null;
}

const root = join(__dirname, '..', '..');
const files = [
  join(root, 'mobile', '.env'),
  join(root, 'supabase', 'functions', '.env'),
];

const address = lanAddress();
if (!address) {
  console.error('No LAN address found (en0/en1). Are you on a network?');
  process.exit(1);
}

console.log(`Current LAN address: ${address}`);

let changed = 0;
for (const file of files) {
  if (!existsSync(file)) {
    console.log(`  skipped (missing): ${file}`);
    continue;
  }
  const before = readFileSync(file, 'utf8');
  const after = withNewAddress(before, address);
  if (before === after) {
    console.log(`  already current: ${file}`);
    continue;
  }
  writeFileSync(file, after);
  changed += 1;
  console.log(`  updated: ${file}`);
}

if (changed > 0) {
  // EXPO_PUBLIC_* is set at bundle time; merely reloading the app
  // otherwise fetches the same old value.
  console.log('\nRestart Metro (npx expo start --lan --clear),');
  console.log('and `supabase functions serve` too, if it is running.');
}
