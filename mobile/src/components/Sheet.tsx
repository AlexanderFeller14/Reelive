import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { cinema, motion, radius, shadow, spacing, type } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';

const REDUZIERTE_DAUER_MS = 200;
// Grosszügig ausserhalb des sichtbaren Bereichs: die tatsächliche Sheet-Höhe hängt
// vom Inhalt ab (Task 12 legt z. B. eine Kommentarliste hinein) — dieser Wert muss
// nur «sicher jenseits jeder realistischen Höhe» sein, keine echte Distanz.
const AUSGANGSPOSITION = 640;
// Wisch-Schwelle: entweder ein ausreichend weiter Weg oder ein schneller Flick
// schliesst das Sheet — unabhängig von der (inhaltsabhängigen) Höhe des Panels.
const WISCH_WEG_SCHWELLE = 96;
const WISCH_GESCHWINDIGKEIT_SCHWELLE = 0.5;
// Begrenzt die Höhe unabhängig vom Inhalt (Review Important 2: eine längere
// Kommentarliste — Task 12 — würde sonst unbegrenzt nach oben wachsen und oben
// aus dem Bild laufen).
const MAX_HOEHE = '85%';

// Reine Entscheidung, ohne PanResponder/Animated drumherum — so bleibt sie ohne
// simulierte Touch-Events direkt testbar (gleiches Prinzip wie queueLogic.ts:
// Entscheidung von Mechanik getrennt).
export function wischUeberSchwelle(dy: number, vy: number): boolean {
  return dy > WISCH_WEG_SCHWELLE || vy > WISCH_GESCHWINDIGKEIT_SCHWELLE;
}

type Props = {
  sichtbar: boolean;
  titel?: string;
  onSchliessen: () => void;
  children: ReactNode;
  // Review Important 2: Task 12 hängt das Kommentar-Panel als Sheet in den
  // Recap-Player (Kino-Kontext, docs/.../design-language-v2-airbnb-design.md
  // §7 «Kommentar-Panel als Sheet (cinema-1)»). `useTheme()` liefert per
  // Konstruktion immer die Licht-Palette (ThemeProvider ist light-only) — ein
  // Kind kann die vom Sheet selbst gezeichneten Flächen (Panel, Grabber, Titel)
  // nicht nachträglich umfärben. Deshalb hier als expliziter Schalter, nicht
  // aus dem Theme ableitbar.
  kino?: boolean;
};

// Erste Sheet-Komponente des Projekts (DESIGN-LANGUAGE §4): von unten, Radius 24
// oben, Grabber, shadow-3, öffnet per spring-ui. Wiederverwendet in Task 12
// (Kommentare).
//
// Schliessen läuft anders als das Öffnen OHNE eigene Austrittsanimation: ein Tipp
// auf den Hintergrund oder ein ausreichender Wisch nach unten ruft sofort
// `onSchliessen`. Das Sheet verschwindet, sobald die aufrufende Stelle `sichtbar`
// auf false setzt — derselbe Kontrollfluss wie bei den Alert.alert-Dialogen in
// reise/[id]/index.tsx: der Elternteil hält den Zustand, die Komponente selbst
// bleibt zustandslos bezüglich «geschlossen wird gerade animiert». Ein Wisch, der
// nicht über die Schwelle kommt, federt zurück statt zu schliessen.
//
// prefers-reduced-motion (§5): keine Verschiebung, nur ein 200-ms-Opacity-Fade —
// für Panel und Hintergrund gemeinsam über denselben Animated.Value.
export function Sheet({ sichtbar, titel, onSchliessen, children, kino }: Props) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const translateY = useRef(new Animated.Value(AUSGANGSPOSITION)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // onSchliessen kann sich zwischen zwei Renderns ändern (neue Funktionsreferenz
  // beim Elternteil) — ein Ref hält die aktuelle Version fest, ohne den
  // PanResponder bei jedem Render neu aufzubauen (gleiches Muster wie
  // Versiegelung.onFertigRef).
  const onSchliessenRef = useRef(onSchliessen);
  onSchliessenRef.current = onSchliessen;

  useEffect(() => {
    if (!sichtbar) return;
    opacity.setValue(0);
    // Frisch berechnet statt modulweit gecacht (gleiche Konvention wie
    // Input.tsx animate()): Easing.bezier() bei jedem Öffnen neu aufzurufen
    // kostet nichts Messbares und hält den Aufruf an der Stelle sichtbar, die
    // ihn auch tatsächlich braucht.
    if (reducedMotion) {
      translateY.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: REDUZIERTE_DAUER_MS,
        easing: Easing.bezier(...motion.easeSmooth),
        useNativeDriver: true,
      }).start();
    } else {
      translateY.setValue(AUSGANGSPOSITION);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...motion.spring }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: motion.duration.base,
          easing: Easing.bezier(...motion.easeSmooth),
          useNativeDriver: true,
        }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sichtbar, reducedMotion]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, geste) => geste.dy > 4 && Math.abs(geste.dy) > Math.abs(geste.dx),
      onPanResponderMove: (_evt, geste) => {
        if (geste.dy > 0) translateY.setValue(geste.dy);
      },
      onPanResponderRelease: (_evt, geste) => {
        if (wischUeberSchwelle(geste.dy, geste.vy)) {
          // Die Komponente bleibt beim Schliessen gemountet (der Elternteil
          // rendert nur `sichtbar=false`) — die Animated.Value-Refs überleben
          // also. Ohne diesen Reset bliebe translateY auf dem letzten
          // Wisch-Offset stehen: der erste Frame des nächsten Öffnens würde an
          // der Altposition aufblitzen, bevor der (erst NACH dem Paint
          // laufende) Öffnen-Effekt sie korrigiert.
          translateY.setValue(reducedMotion ? 0 : AUSGANGSPOSITION);
          onSchliessenRef.current();
          return;
        }
        if (reducedMotion) {
          translateY.setValue(0);
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...motion.spring }).start();
        }
      },
    })
  ).current;

  if (!sichtbar) return null;

  const flaeche = kino ? cinema['bg-1'] : colors['bg-0'];
  const textFarbe = kino ? cinema['text-1'] : colors['text-1'];
  const grabberFarbe = kino ? cinema['text-2'] : colors['line-strong'];

  return (
    // Review Important 2: ein Eingabefeld am unteren Rand (Task 12: Kommentar-
    // Eingabe) braucht Tastatur-Ausweichlogik — das lässt sich aus einem Kind
    // heraus nicht nachrüsten, weil das Sheet selbst `bottom:0`-positioniert
    // ist. Gleiches Muster wie preview.tsx: `padding` auf iOS, Android regelt
    // das über windowSoftInputMode am Fenster.
    <KeyboardAvoidingView
      testID="sheet-root"
      style={StyleSheet.absoluteFill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable
        testID="sheet-backdrop"
        accessibilityRole="button"
        accessibilityLabel="Schliessen"
        style={StyleSheet.absoluteFill}
        onPress={onSchliessen}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.hintergrund, { opacity }]} />
      </Pressable>
      {/* Schatten und Fläche getrennt von der Höhenbegrenzung: ein iOS-Schatten
          braucht eine sichtbare (nicht transparente) Fläche, auf der er liegt,
          UND darf nicht von `overflow:'hidden'` mitgeklippt werden — deshalb
          trägt der äussere Knoten Fläche+Schatten+Bewegung, der innere nur die
          Begrenzung/das Clipping. */}
      <Animated.View
        testID="sheet-schatten"
        style={[styles.schatten, { backgroundColor: flaeche, opacity, transform: [{ translateY }] }]}
      >
        <View testID="sheet-panel" style={styles.panelClip}>
          {/* Nur der Griffbereich ist wischbar — der Rest bleibt frei für
              Inhalt wie Listen oder Eingabefelder (Task 12), die eigene
              Touch-Gesten (Scroll) brauchen. */}
          <View testID="sheet-griff-bereich" style={styles.griffBereich} {...pan.panHandlers}>
            <View testID="sheet-griff" style={[styles.griff, { backgroundColor: grabberFarbe }]} />
            {titel ? <Text style={[type.h3, { color: textFarbe }]}>{titel}</Text> : null}
          </View>
          <View style={styles.inhalt}>{children}</View>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Review: einziger hartcodierter Farbwert ausserhalb der in §1 sanktionierten
  // Foto-Scrims — aber kein frei erfundener Wert: der Begleittext nennt für
  // GENAU dieses Bauteil «Scrim rgba(0,0,0,0.4) faded 250 ms»
  // (docs/superpowers/specs/2026-08-06-design-language-v2-airbnb-design.md,
  // Abschnitt Sheet), gleiches Prinzip wie preview.tsx's Foto-Scrim-Literale.
  // `palette`/`cinema` kennen noch keinen Backdrop-Token für einen reinen
  // Dimm-Overlay (anders als `overlay-pill`, das für Fotos gedacht ist) — ein
  // solcher Token gehört in `mobile/src/theme/tokens.ts`, ausserhalb des
  // Datei-Scopes dieses Tasks (nur Sheet.tsx + reise/[id]/index.tsx).
  hintergrund: { backgroundColor: 'rgba(0,0,0,0.4)' },
  schatten: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    ...shadow.s3,
  },
  panelClip: {
    maxHeight: MAX_HOEHE,
    overflow: 'hidden',
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingBottom: spacing.xl,
  },
  griffBereich: { alignItems: 'center', paddingTop: spacing.m, paddingBottom: spacing.base, gap: spacing.base },
  griff: { width: 36, height: 4, borderRadius: radius.pill },
  inhalt: { paddingHorizontal: spacing.screen, gap: spacing.base },
});
