// Zieht die LAN-Adresse in Konfigurationsdateien nach. Die reine Regel, ohne
// Dateien und ohne Netz — netz.js benutzt sie.
//
// Warum es das braucht: Die lokalen Dienste sind für ein echtes iPhone nur
// über die LAN-IP des Rechners erreichbar, und die kommt per DHCP — zuhause
// eine andere als im Büro. Die App kommt seit src/lib/supabaseAdresse.ts ohne
// aus (sie kennt den Rechner, der ihr Bundle geliefert hat). Die Edge
// Functions können das nicht: Sie backen die Adresse in SIGNIERTE URLs, und
// die Signatur deckt den Rechnernamen mit ab — nachträglich umbiegen geht
// also nicht.

// Nur Zeilen mit einer Adresse werden angefasst. Das schützt Schlüssel und
// Token: dort darf keine Zeichenfolge, die zufällig wie eine IP aussieht,
// überschrieben werden.
const HAT_ADRESSE = /:\/\//;

// Was nur im eigenen Netz gilt — und damit morgen etwas anderes heissen kann.
// Öffentliche Adressen bleiben unangetastet.
const LOKAL =
  /\b(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;

function mitNeuerAdresse(inhalt, neueAdresse) {
  return inhalt
    .split('\n')
    .map((zeile) => (HAT_ADRESSE.test(zeile) ? zeile.replace(LOKAL, neueAdresse) : zeile))
    .join('\n');
}

module.exports = { mitNeuerAdresse };
