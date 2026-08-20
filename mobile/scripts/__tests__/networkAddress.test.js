const { withNewAddress } = require('../networkAddress');

const NEW = '192.168.1.213';

test('ersetzt eine veraltete Adresse in einer URL-Zeile', () => {
  expect(withNewAddress('S3_ENDPOINT=http://192.168.1.30:54321/storage/v1/s3', NEW)).toBe(
    'S3_ENDPOINT=http://192.168.1.213:54321/storage/v1/s3'
  );
});

test('Port und Pfad bleiben stehen', () => {
  expect(withNewAddress('EXPO_PUBLIC_SHARE_BASE_URL=http://10.0.0.7:8081/share', NEW)).toBe(
    'EXPO_PUBLIC_SHARE_BASE_URL=http://192.168.1.213:8081/share'
  );
});

test('auch localhost wird ersetzt — für ein Handy wäre das seine eigene Adresse', () => {
  expect(withNewAddress('X=http://localhost:54321', NEW)).toBe('X=http://192.168.1.213:54321');
  expect(withNewAddress('X=http://127.0.0.1:54321', NEW)).toBe('X=http://192.168.1.213:54321');
});

test('öffentliche Adressen bleiben unangetastet', () => {
  const zeile = 'API=https://api.example.com/v1';
  expect(withNewAddress(zeile, NEW)).toBe(zeile);
});

test('eine Zeile ohne URL wird nie angefasst', () => {
  // Schutz für Schlüssel und Token: dort darf keine Zeichenfolge, die zufällig
  // wie eine Adresse aussieht, überschrieben werden.
  const zeile = 'SERVICE_KEY=abc.192.168.1.30.def';
  expect(withNewAddress(zeile, NEW)).toBe(zeile);
});

test('mehrere Zeilen werden gemeinsam nachgezogen', () => {
  const vorher = [
    '# Kommentar',
    'S3_ENDPOINT=http://192.168.1.30:54321/storage/v1/s3',
    'GEHEIM=nichts',
    'EXPO_PUBLIC_SHARE_BASE_URL=http://192.168.1.30:8081',
  ].join('\n');
  expect(withNewAddress(vorher, NEW)).toBe(
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
  expect(withNewAddress(zeile, NEW)).toBe(zeile);
});
