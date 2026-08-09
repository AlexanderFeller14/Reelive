// Ein Stylesheet als Modul: Expos Metro bündelt CSS-Imports im Web-Bundle,
// TypeScript kennt sie ohne diese Zeile nicht (TS2882 beim Seiteneffekt-Import).
//
// Gebraucht von KartenFlaeche.web.tsx: `import 'leaflet/dist/leaflet.css'`.
// Ohne Leaflets eigenes Stylesheet liegen die Kacheln als ungeordneter
// Bilderstapel übereinander — die Datei MUSS mit ins Bundle.
declare module '*.css';
