// Stylesheets sind für Metro ein Modul wie jedes andere (Expo Web bündelt sie),
// für Jest nicht: es gibt keinen Transformer dafür, und schon `import
// 'leaflet/dist/leaflet.css'` in KartenFlaeche.web.tsx liesse den Testlauf an
// der ersten CSS-Regel scheitern.
//
// Ein leeres Modul reicht: was in der Datei steht, gehört ins Browser-Bundle
// (ohne sie liegen Leaflets Kacheln als ungeordneter Bilderstapel übereinander)
// und hat auf die Zusicherungen der Tests keinen Einfluss.
module.exports = {};
