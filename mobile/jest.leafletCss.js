// Leaflets Stylesheet im Testlauf.
//
// Metro bündelt CSS-Importe im Web-Bundle, Jest hat keinen Transformer dafür:
// ohne diese Zuordnung (package.json, `moduleNameMapper`) scheiterte der
// Testlauf an der ersten Regel in `leaflet/dist/leaflet.css`.
//
// Der Stub ist bewusst NICHT bloss leer. `import 'leaflet/dist/leaflet.css'`
// ist die einzige verbindliche Vorgabe der Browser-Fassung, die man spurlos
// löschen kann: der Ausfall (Kacheln als ungeordneter Bilderstapel, keine
// Nadel auf ihrer Koordinate) zeigt sich erst im Browser, nie in einem Test.
// Also hinterlässt das Laden hier eine Spur, an der KartenFlaeche.web.test.tsx
// festhält, dass die Zeile steht.
//
// Am `globalThis` und nicht am Modul-Export: der Import ist ein
// Seiteneffekt-Import, sein Rückgabewert kommt nirgends an.
globalThis.__leafletCssImportiert = true;

module.exports = {};
