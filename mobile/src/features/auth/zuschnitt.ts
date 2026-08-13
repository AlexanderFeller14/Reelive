// Die Rechnung hinter dem Zuschnitt-Fenster: aus dem, was am Bildschirm zu
// sehen ist, den Ausschnitt im ORIGINALBILD bestimmen.
//
// Warum das eine eigene Datei ist: Es ist der Teil, an dem sich ein Vorzeichen
// oder ein vergessener Faktor lautlos versteckt — das Ergebnis sieht dann
// «irgendwie verschoben» aus, und am Gerät ist das kaum auseinanderzuhalten.
// Ohne UI ist es dagegen mit ein paar Zahlen erschöpfend prüfbar.
//
// Das Modell in einem Satz: Ein quadratischer Rahmen steht fest, das Bild
// darunter lässt sich verschieben und zoomen; zurückgegeben wird der Bereich
// des Originals, der am Ende im Rahmen liegt.

export type Quellmass = { breite: number; hoehe: number };

export type Blick = {
  // Zoom, 1 = das Bild füllt den Rahmen gerade eben («cover»). Kleiner als 1
  // ist nicht erlaubt, sonst entstünden leere Ränder im Rahmen.
  zoom: number;
  // Verschiebung in Bildschirmpunkten, gemessen vom mittigen Sitz aus.
  // Positiv = das Bild wandert nach rechts bzw. nach unten.
  versatzX: number;
  versatzY: number;
};

export type Ausschnitt = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

// Der Faktor, mit dem das Original dargestellt wird, wenn es den Rahmen gerade
// ausfüllt: die KÜRZERE Kante bestimmt ihn, sonst bliebe quer dazu eine Lücke.
export function grundfaktor(quelle: Quellmass, rahmen: number): number {
  return rahmen / Math.min(quelle.breite, quelle.hoehe);
}

// Wie weit sich das Bild bei diesem Zoom überhaupt schieben lässt, bevor eine
// Kante in den Rahmen rutscht — je Achse die Hälfte des Überhangs.
export function grenzen(
  quelle: Quellmass,
  rahmen: number,
  zoom: number,
): { x: number; y: number } {
  const faktor = grundfaktor(quelle, rahmen) * zoom;
  return {
    x: Math.max(0, (quelle.breite * faktor - rahmen) / 2),
    y: Math.max(0, (quelle.hoehe * faktor - rahmen) / 2),
  };
}

// Hält einen Blick innerhalb des Erlaubten: Zoom nie unter 1 (sonst Lücken),
// Verschiebung nie so weit, dass eine Bildkante sichtbar wird.
//
// Bewusst hier und nicht erst beim Zuschneiden: Die Oberfläche zeigt damit
// genau das, was am Ende herauskommt — ein Bild, das sich weiter schieben
// lässt als es darf und beim Loslassen zurückspringt, fühlt sich kaputt an.
export function begrenze(blick: Blick, quelle: Quellmass, rahmen: number): Blick {
  const zoom = Math.max(1, blick.zoom);
  const g = grenzen(quelle, rahmen, zoom);
  return {
    zoom,
    versatzX: Math.min(g.x, Math.max(-g.x, blick.versatzX)),
    versatzY: Math.min(g.y, Math.max(-g.y, blick.versatzY)),
  };
}

// Der eigentliche Übersetzer: Blick → Ausschnitt in Originalkoordinaten.
//
// Herleitung, damit die Vorzeichen nachvollziehbar bleiben: Im Rahmen ist ein
// Quadrat der Seitenlänge `rahmen / faktor` des Originals zu sehen. Ohne
// Verschiebung sitzt es mittig. Ein Versatz nach rechts (positiv) schiebt das
// BILD nach rechts, das Fenster wandert dadurch im Original nach LINKS —
// daher das Minus.
export function ausschnittFuer(
  blick: Blick,
  quelle: Quellmass,
  rahmen: number,
): Ausschnitt {
  const sicher = begrenze(blick, quelle, rahmen);
  const faktor = grundfaktor(quelle, rahmen) * sicher.zoom;
  const seite = rahmen / faktor;

  const roh = {
    x: (quelle.breite - seite) / 2 - sicher.versatzX / faktor,
    y: (quelle.hoehe - seite) / 2 - sicher.versatzY / faktor,
  };

  // Auf ganze Pixel runden und in die Bildgrenzen zwingen. Das Runden kann den
  // Ausschnitt sonst um einen Pixel über den Rand schieben, und der native
  // Zuschnitt lehnt das ab, statt zu klemmen.
  const seiteGanz = Math.min(
    Math.round(seite),
    Math.floor(quelle.breite),
    Math.floor(quelle.hoehe),
  );
  return {
    originX: Math.min(Math.max(0, Math.round(roh.x)), quelle.breite - seiteGanz),
    originY: Math.min(Math.max(0, Math.round(roh.y)), quelle.hoehe - seiteGanz),
    width: seiteGanz,
    height: seiteGanz,
  };
}
