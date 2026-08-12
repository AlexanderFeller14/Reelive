import type { ImageSourcePropType } from 'react-native';

// Platzhalter-Cover, solange Reisen kein eigenes Bild tragen. Der Pfad muss
// statisch im `require` stehen, zusammengebaute Pfade findet Metro nicht
// (assets/images/README.md), deshalb eine feste Liste statt einer Namenstabelle.
const COVER: ImageSourcePropType[] = [
  require('@/assets/images/camper-thumbnail-16-9.png'),
  require('@/assets/images/ferienhaus-thumbnail-16-9.png'),
];

// Welches Bild eine Karte bekommt, hängt an ihrer Position in der Liste: die
// erste Karte trägt das erste Bild, die zweite das zweite, danach beginnt die
// Reihe von vorn. Damit stehen nie zwei gleiche Cover untereinander, solange
// mindestens zwei Bilder in der Liste liegen.
//
// Die Alternative wäre gewesen, das Bild aus der Trip-id abzuleiten. Das hätte
// es an die Reise gebunden statt an ihren Platz — aber mit zwei Bildern ist
// jede solche Ableitung ein Münzwurf pro Reise, und zwei Reisen zeigen dann in
// der Hälfte der Fälle dasselbe Cover. Genau das war zu sehen.
//
// Der Preis dieser Wahl: Das Bild gehört dem Platz, nicht der Reise. Eine neu
// angelegte Reise schiebt sich vor die anderen und lässt deren Cover
// weiterrücken. Und das Reise-Detail ist keine Liste — es bekommt den Platz
// der angetippten Karte als `cover`-Parameter der Route mitgereicht, damit
// dort dasselbe Bild steht; wer ohne diesen Parameter dort landet (Deep Link,
// frisch angelegte Reise), sieht das erste. Beides ist der Grund, warum das
// hier ein Platzhalter bleibt: Sobald `trips` eine Cover-Spalte hat, gehört
// das Bild wieder der Reise, und diese Datei fällt weg.
export function platzhalterCover(position: number): ImageSourcePropType {
  return COVER[position % COVER.length];
}
