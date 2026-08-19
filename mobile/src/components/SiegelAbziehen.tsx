import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BlurMask,
  Canvas,
  FilterMode,
  Group,
  ImageShader,
  MipmapMode,
  Oval,
  Vertices,
  useImage,
} from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PressScale } from '@/components/PressScale';
import { motion } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/useReducedMotion';
import {
  ABGEZOGEN_AB_MS,
  BUEHNE,
  DAUER_MS,
  RASTER,
  dreieckIndizes,
  knotenPositionen,
  schattenParameter,
  texturKoordinaten,
} from '@/features/recap/siegelPeel';

const REDUZIERTE_DAUER_MS = 200;

// Farbe des Bodenschattens aus dem Prototyp (warmes Dunkelbraun, kein
// neutrales Schwarz: der Schatten liegt unter rotem Wachs auf hellem Grund).
const SCHATTEN_FARBE = '#36150D';
// Neigung der Schatten-Ellipse (Radiant), ebenfalls Prototyp.
const SCHATTEN_DREHUNG = [{ rotate: -0.18 }];

type Props = {
  // Kantenlänge der quadratischen Bühne in Punkten. Das Siegel selbst nimmt
  // davon 500/720 ein (siegelPeel.SIEGEL), der Rest ist Luft, in die es sich
  // beim Abziehen hinein aufrollt.
  groesse: number;
  // Wird gemeldet, sobald die Bühne leer ist (siegelPeel.ABGEZOGEN_AB_MS),
  // nicht erst am Ende des Schatten-Ausklangs; bei Reduced Motion nach dem
  // 200-ms-Fade.
  onAbgezogen: () => void;
  testID?: string;
};

// Das Wachssiegel auf der Recap-Übersicht, das die Person selbst abzieht:
// ein Tipp, dann löst es sich wie ein flexibler Sticker von unten rechts her
// ab, rollt sich auf und fliegt nach oben links aus dem Bild (Physik in
// features/recap/siegelPeel.ts, portiert aus docs/design/reelive-sticker-
// peel.html). Gezeichnet mit Skia: das Siegel-PNG liegt als Textur auf einem
// Dreiecksnetz, dessen Knoten pro Frame auf dem UI-Thread neu berechnet
// werden (`useDerivedValue` aus einem einzigen Fortschritts-Wert), Skia liest
// die Shared Values direkt, kein Frame läuft über die JS-Bridge.
//
// Zeitgeber: der Fortschritt läuft LINEAR über DAUER_MS. Das ist keine
// Verletzung von DESIGN-LANGUAGE §5 («linear ist verboten»), sondern die dort
// benannte Ausnahme: der Wert bildet reale Zeit ab, die Kurven (Smoothstep
// der Front, Verlauf des Schattens) stecken in der Physik selbst, genau wie
// im Prototyp, wo `p` ebenfalls die rohe Uhr ist.
//
// `onAbgezogen` kommt über einen eigenen `setTimeout`, nicht über den
// Abschluss-Callback von withTiming: gleiches Muster wie RevealInszenierung
// (in Tests ohne natives Animated-Modul löst der Callback sofort aus statt
// nach der Dauer), und der Zeitpunkt (85 % der Dauer, wenn kein Knoten mehr
// in der Bühne liegt) ist ohnehin nicht das Ende der Animation.
//
// Ablauf als Zustand (`modus`) plus Effekt statt direkt im Tipp-Handler,
// wie RevealInszenierung (`sichtbar` → Effekt): der Tipp entscheidet nur,
// WAS läuft (Peel oder, bei Reduced Motion, Fade), der Effekt startet
// Animation und Timer und räumt beides in seinem Cleanup wieder ab, ein
// Unmount mitten im Abziehen lässt so weder einen Timer noch eine Rechnung
// auf dem UI-Thread zurück.
type Modus = 'ruhe' | 'peel' | 'fade';

export function SiegelAbziehen({ groesse, onAbgezogen, testID }: Props) {
  const reducedMotion = useReducedMotion();
  const bild = useImage(require('@/assets/images/rotes-brief-wachssiegel-transparent.png'));
  const fortschritt = useSharedValue(0);
  const deckkraft = useSharedValue(1);
  const [modus, setModus] = useState<Modus>('ruhe');
  const laeuft = modus !== 'ruhe';
  // Immer der aktuelle Callback, ohne dass eine neue Identität von aussen
  // den laufenden Effekt neu startet (der Screen definiert ihn inline).
  const onAbgezogenRef = useRef(onAbgezogen);
  useEffect(() => {
    onAbgezogenRef.current = onAbgezogen;
  }, [onAbgezogen]);

  useEffect(() => {
    if (modus === 'ruhe') return;
    let dauer: number;
    if (modus === 'fade') {
      dauer = REDUZIERTE_DAUER_MS;
      deckkraft.value = withTiming(0, {
        duration: REDUZIERTE_DAUER_MS,
        easing: Easing.bezier(...motion.easeSmooth),
      });
    } else {
      dauer = ABGEZOGEN_AB_MS;
      fortschritt.value = withTiming(1, { duration: DAUER_MS, easing: Easing.linear });
    }
    const timer = setTimeout(() => onAbgezogenRef.current(), dauer);
    return () => {
      clearTimeout(timer);
      cancelAnimation(fortschritt);
      cancelAnimation(deckkraft);
    };
  }, [modus, fortschritt, deckkraft]);

  // Netz-Topologie und Texturkoordinaten sind fix, nur die Knotenpositionen
  // bewegen sich. Die Texturen brauchen die Bildmasse in Pixeln (Skia liest
  // sie ohne `rect` am ImageShader im Pixelraum des Bildes).
  const indizes = useMemo(() => dreieckIndizes(RASTER), []);
  const texturen = useMemo(
    () => (bild ? texturKoordinaten(RASTER, bild.width(), bild.height()) : null),
    [bild]
  );

  const knoten = useDerivedValue(() => knotenPositionen(fortschritt.value, RASTER));
  const schattenRect = useDerivedValue(() => {
    const s = schattenParameter(fortschritt.value);
    return { x: s.x - s.rx, y: s.y - s.ry, width: 2 * s.rx, height: 2 * s.ry };
  });
  const schattenMitte = useDerivedValue(() => {
    const s = schattenParameter(fortschritt.value);
    return { x: s.x, y: s.y };
  });
  const schattenDeckkraft = useDerivedValue(() => schattenParameter(fortschritt.value).deckkraft);
  const schattenWeichheit = useDerivedValue(() => schattenParameter(fortschritt.value).weichheit);

  // Alles wird in Bühnen-Einheiten (720) gerechnet und als Ganzes auf die
  // Punktgrösse skaliert; die Weichheit des Schattens skaliert mit
  // (BlurMask respectCTM, Standard), so bleibt jede Zahl die des Prototyps.
  const massstab = groesse / BUEHNE;

  const abziehen = () => {
    if (laeuft) return;
    // DESIGN-LANGUAGE §5: Haptik success beim Reveal. Genau einmal, beim Tipp,
    // nicht am Ende: die Person hat gerade selbst etwas aufgebrochen.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Reduced Motion wird HIER festgehalten, nicht im Effekt gelesen: schaltet
    // jemand die Einstellung mitten im Abziehen um, läuft das Begonnene zu
    // Ende, statt neu zu starten.
    setModus(reducedMotion ? 'fade' : 'peel');
  };

  return (
    // Press-Feedback wie eine randlose Karte (§5: Scale per Spring, hier 0.98,
    // nie Opacity), gesperrt, sobald das Abziehen läuft: ein zweiter Tipp
    // dürfte weder die Haptik noch den Timer ein zweites Mal auslösen.
    <PressScale
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel="Siegel abziehen"
      accessibilityState={{ disabled: laeuft }}
      disabled={laeuft}
      onPress={abziehen}
      testID={testID}
      style={{ width: groesse, height: groesse }}
    >
      <Canvas testID="siegel-buehne" style={{ width: groesse, height: groesse }}>
        {bild && texturen && (
          <Group transform={[{ scale: massstab }]} opacity={deckkraft}>
            <Oval
              rect={schattenRect}
              color={SCHATTEN_FARBE}
              opacity={schattenDeckkraft}
              origin={schattenMitte}
              transform={SCHATTEN_DREHUNG}
            >
              <BlurMask blur={schattenWeichheit} style="normal" />
            </Oval>
            <Vertices
              vertices={knoten}
              textures={texturen}
              indices={indizes}
              mode="triangles"
            >
              {/* Mipmaps, weil das PNG (1254 px) auf dem Gerät verkleinert
                  gezeichnet wird; ohne sie flimmert das Wachsrelief beim
                  Aufrollen. Clamp statt Decal: die Ränder des Netzes liegen
                  im transparenten Rand des PNGs, es gibt nichts zu kacheln. */}
              <ImageShader
                image={bild}
                tx="clamp"
                ty="clamp"
                sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}
              />
            </Vertices>
          </Group>
        )}
      </Canvas>
    </PressScale>
  );
}
