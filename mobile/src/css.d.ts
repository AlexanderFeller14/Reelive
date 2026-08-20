// A stylesheet as a module: Expo's Metro bundles CSS imports into the web
// bundle, TypeScript does not know them without this line (TS2882 on the
// side-effect import).
//
// Deliberately ONLY this one stylesheet and no `declare module '*.css'`: a
// placeholder declaration would apply to the whole tree, including a NATIVE
// file. There a CSS import would type-check cleanly from then on and only show
// up while bundling, with an error that no longer has anything to do with the
// line that caused it.
//
// Needed by MapSurface.web.tsx. Without Leaflet's own stylesheet the tiles lie
// on top of each other as an unordered stack of images, the file MUST go into
// the bundle.
declare module 'leaflet/dist/leaflet.css';
