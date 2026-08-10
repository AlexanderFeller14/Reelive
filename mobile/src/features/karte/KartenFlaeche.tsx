import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { KartenNadelMarker } from '@/components/KartenNadel';
import { useTheme } from '@/theme/ThemeProvider';
import { motion } from '@/theme/tokens';
import { aufEinemFleck } from '@/features/karte/gruppierung';
import type {
  Ausschnitt,
  Gruppe,
  KartenFlaecheHandle,
  KartenFlaecheProps,
  KartenPunkt,
} from '@/features/karte/typen';

// Die Kartenfläche, native Fassung: react-native-maps auf Apple Maps bzw.
// Google Maps. Der Zwilling für den Browser steht in KartenFlaeche.web.tsx und
// erfüllt denselben Vertrag (features/karte/typen.ts) mit Leaflet.
//
// Was hier drin steckt, stand bis Task 14 direkt im Kartenscreen
// (app/(tabs)/recap/[id]/karte.tsx). Herausgezogen ist genau die FLÄCHE:
// Nadeln, Linie, Kamera und die Meldung des sichtbaren Ausschnitts. Alles
// andere bleibt beim Screen, was eine Gruppe auslöst, welcher Tag gefiltert
// ist, welches Sheet offen steht. Diese Fläche weiss von Reisen, Sheets und
// Tagen nichts; sie zeigt, was man ihr gibt, und meldet, was passiert.
export const KartenFlaeche = forwardRef<KartenFlaecheHandle, KartenFlaecheProps>(
  function KartenFlaeche(
    { initialerAusschnitt, gruppen, linie, thumbFuer, aufGruppe, aufAusschnitt, reducedMotion },
    ref
  ) {
    const { colors } = useTheme();
    const karte = useRef<MapView>(null);

    // DIE eine Stelle, an der sich die Kamera bewegt (Spec K12): der
    // Gruppen-Zoom und der Tagesfilter rufen beide hierher. Zwei Wege liefen
    // garantiert auseinander, und an einem von beiden fehlte irgendwann die
    // Reduced-Motion-Weiche.
    //
    // Der Erststart geht bewusst NICHT hier durch: die Karte öffnet mit
    // `initialRegion` direkt am Ziel. Es gibt nichts, wovon aus gefahren würde.
    useImperativeHandle(
      ref,
      () => ({
        zeige: (ziel: Ausschnitt) => {
          // DESIGN-LANGUAGE §5: mit Reduced Motion wird gesprungen statt
          // gefahren. `setRegion` ist der Sprung, es ruft intern
          // `animateToRegion` mit Dauer 0 auf dem Fabric-Handle auf
          // (MapView.tsx:863-867).
          //
          // NICHT `setNativeProps`, obwohl MapView die Methode hat und sie
          // typprüft: sie reicht an `this.map` weiter, und dieses Ref wird in
          // 1.27.2 an KEIN Element gehängt (`ref={this.map}` kommt nirgends
          // vor, nur `ref={this.fabricMap}`). `this.map.current` ist damit
          // immer null, der Aufruf ein stiller No-op. Kein Absturz, der
          // auffiele, eine Kamera, die einfach stehen bleibt, und zwar nur
          // für die, die Reduced Motion eingeschaltet haben.
          if (reducedMotion) karte.current?.setRegion(ziel);
          else karte.current?.animateToRegion(ziel, motion.duration.base);
        },
      }),
      [reducedMotion]
    );

    // Welche Gruppe hinter der getippten Nadel steckt, aus einem Ref, nicht
    // aus den Abhängigkeiten von `angetippt`. Hinge die Funktion an `gruppen`,
    // bekäme jede Nadel bei JEDER Kartenbewegung ein neues `onPress`; das
    // `memo` am Marker (KartenNadel.tsx) wäre wirkungslos, und jede Nadel
    // schickte ihre Koordinate erneut über die Brücke, obwohl sich an ihr
    // nichts geändert hat.
    //
    // `useLayoutEffect`, nicht `useEffect`: ein passiver Effekt läuft erst NACH
    // dem Commit, und in dem Fenster dazwischen liest ein Tipp noch den alten
    // Stand. Das ist kein theoretischer Fall, die Karte kommt aus einer Fahrt,
    // die Gruppe ist gerade zerfallen, und wer sofort auf die neu erschienene
    // Nadel tippt, wird in den alten Gruppen nicht gefunden (dort war sie
    // Mitglied, kein Anker), und das Moment-Sheet bliebe aus, ohne dass
    // irgendwo ein Fehler entstünde. Festgenagelt in karte.test.tsx («ein Tipp
    // unmittelbar nach dem Zerfall einer Gruppe wird nicht verschluckt»).
    const stand = useRef<Gruppe[]>(gruppen);
    useLayoutEffect(() => {
      stand.current = gruppen;
    }, [gruppen]);

    // Der Marker meldet den ANKER zurück (KartenNadel.tsx), hier wird daraus
    // die ganze Gruppe, denn das ist, was der Screen zu entscheiden hat.
    const angetippt = useCallback(
      (anker: KartenPunkt) => {
        const gruppe = stand.current.find((g) => g.anker === anker);
        // Unerreichbar, solange die Nadel aus `gruppen` stammt, aber ein
        // Ref, das vom Baum abweicht, wäre genau der Fehler, den der
        // Layout-Effekt oben verhindert. Lieber nichts tun als eine falsche
        // Gruppe melden.
        if (gruppe) aufGruppe(gruppe);
      },
      [aufGruppe]
    );

    return (
      <MapView
        ref={karte}
        testID="karte-flaeche"
        style={StyleSheet.absoluteFill}
        initialRegion={initialerAusschnitt}
        onRegionChangeComplete={aufAusschnitt}
      >
        {/* Die Linie steht VOR den Nadeln im Baum, damit sie unter ihnen
            liegt. Unter zwei Punkten gibt es nichts zu verbinden. */}
        {linie.length > 1 && (
          <Polyline
            testID="karte-linie"
            coordinates={linie}
            strokeColor={colors.accent}
            strokeWidth={3}
          />
        )}

        {/* Der Schlüssel hängt am Anker, nicht am Inhalt der Gruppe: beim
            Zoomen ändert sich die Zusammensetzung laufend, und ein Schlüssel
            aus ihr heraus hängte jedes Mal eine neue Nadel an die Karte,
            statt die vorhandene weiterzuzeichnen. */}
        {gruppen.map((g) => (
          <KartenNadelMarker
            key={g.anker.moment.id}
            punkt={g.anker}
            thumbUrl={thumbFuer(g.anker.moment.id)}
            anzahl={g.punkte.length}
            // Dieselbe Auskunft, die der Screen für den Tipp benutzt, damit
            // das Label für VoiceOver nennt, was der Tipp WIRKLICH tut:
            // heranzoomen oder das Sheet öffnen. Eine zweite eigene Regel
            // hier liefe irgendwann gegen die dort.
            unteilbar={aufEinemFleck(g)}
            onPress={angetippt}
          />
        ))}
      </MapView>
    );
  }
);
