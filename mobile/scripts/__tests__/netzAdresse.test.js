const { mitNeuerAdresse } = require('../netzAdresse');

const NEU = '192.168.1.213';

test('ersetzt eine veraltete Adresse in einer URL-Zeile', () => {
  expect(mitNeuerAdresse('S3_ENDPOINT=http://192.168.1.30:54321/storage/v1/s3', NEU)).toBe(
    'S3_ENDPOINT=http://192.168.1.213:54321/storage/v1/s3'
  );
});

test('Port und Pfad bleiben stehen', () => {
  expect(mitNeuerAdresse('EXPO_PUBLIC_SHARE_BASE_URL=http://10.0.0.7:8081/share', NEU)).toBe(
    'EXPO_PUBLIC_SHARE_BASE_URL=http://192.168.1.213:8081/share'
  );
});

test('auch localhost wird ersetzt — für ein Handy wäre das seine eigene Adresse', () => {
  expect(mitNeuerAdresse('X=http://localhost:54321', NEU)).toBe('X=http://192.168.1.213:54321');
  expect(mitNeuerAdresse('X=http://127.0.0.1:54321', NEU)).toBe('X=http://192.168.1.213:54321');
});

test('öffentliche Adressen bleiben unangetastet', () => {
  const zeile = 'API=https://api.example.com/v1';
  expect(mitNeuerAdresse(zeile, NEU)).toBe(zeile);
});

test('eine Zeile ohne URL wird nie angefasst', () => {
  // Schutz für Schlüssel und Token: dort darf keine Zeichenfolge, die zufällig
  // wie eine Adresse aussieht, überschrieben werden.
  const zeile = 'SERVICE_KEY=abc.192.168.1.30.def';
  expect(mitNeuerAdresse(zeile, NEU)).toBe(zeile);
});

test('mehrere Zeilen werden gemeinsam nachgezogen', () => {
  const vorher = [
    '# Kommentar',
    'S3_ENDPOINT=http://192.168.1.30:54321/storage/v1/s3',
    'GEHEIM=nichts',
    'EXPO_PUBLIC_SHARE_BASE_URL=http://192.168.1.30:8081',
  ].join('\n');
  expect(mitNeuerAdresse(vorher, NEU)).toBe(
    [
      '# Kommentar',
      'S3_ENDPOINT=http://192.168.1.213:54321/storage/v1/s3',
      'GEHEIM=nichts',
      'EXPO_PUBLIC_SHARE_BASE_URL=http://192.168.1.213:8081',
    ].join('\n')
  );
});

test('steht die Adresse schon richtig, ändert sich nichts', () => {
  const zeile = 'S3_ENDPOINT=http://192.168.1.213:54321';
  expect(mitNeuerAdresse(zeile, NEU)).toBe(zeile);
});
