// Ein Stylesheet als Modul: Expos Metro bündelt CSS-Importe im Web-Bundle,
// TypeScript kennt sie ohne diese Zeile nicht (TS2882 beim Seiteneffekt-Import).
//
// Bewusst NUR dieses eine Stylesheet und kein `declare module '*.css'`: eine
// Platzhalter-Deklaration gilt für den ganzen Baum, also auch für eine NATIVE
// Datei. Dort typprüfte ein CSS-Import ab sofort sauber durch und fiele erst
// beim Bündeln auf, mit einem Fehler, der nichts mehr mit der Zeile zu tun
// hat, die ihn verursacht.
//
// Gebraucht von MapSurface.web.tsx. Ohne Leaflets eigenes Stylesheet liegen
// die Kacheln als ungeordneter Bilderstapel übereinander, die Datei MUSS mit
// ins Bundle.
declare module 'leaflet/dist/leaflet.css';
