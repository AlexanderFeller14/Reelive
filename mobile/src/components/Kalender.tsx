import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import {
  todayOrDefault, monthHeight, monthIndexFor, monthOffset, monthsInRange,
  dayLabel, cellRole, MONTH_GAP, MONTH_HEADER_HEIGHT, ROW_HEIGHT,
  type Selection, type Month, type CellRole,
} from '@/features/trips/calendar';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Der sichtbare Kreis ist kleiner als seine Zelle: die Zelle ist das Touch-Ziel
// und misst ZEILE_HOEHE mal ein Siebtel der Rasterbreite, beides über den 44 px
// aus Apples Human Interface Guidelines. Ein fester Durchmesser bleibt zudem
// unabhängig von der Gerätebreite ein Kreis statt eines Ovals.
const KREIS = 40;

type Props = {
  auswahl: Selection;
  onTag: (tag: string) => void;
  // Ohne diesen Einstieg hinge jeder Test am echten Systemdatum und bräche im
  // Folgemonat (gleiches Muster wie heutigerKalendertag(jetzt = new Date())).
  heute?: string;
};

export function Kalender({ auswahl, onTag, heute }: Props) {
  const { colors } = useTheme();
  const tagHeute = todayOrDefault(heute);
  const monate = useMemo(() => monthsInRange(tagHeute), [tagHeute]);
  const ersterTag = monate[0].weeks.flat().find(Boolean) as string;
  const letzterTag = monate[monate.length - 1].weeks.flat().filter(Boolean).pop() as string;

  // Nur der erste Rendervorgang springt, danach scrollt der Nutzer selbst.
  // Als Lazy-Initializer statt als Ref: der Wert wird genau einmal berechnet
  // und bleibt danach konstant, ohne dass währenddessen ein Ref gelesen wird.
  const [startIndex] = useState(() => monthIndexFor(monate, auswahl.start ?? tagHeute));

  return (
    // Füllt den Elternteil, statt sich selbst eine Höhe zu geben. Das setzt
    // voraus, dass dieser eine definite Höhe HAT: im `Sheet`, dessen Inhalt
    // keine hat, stand der Kalender null hoch im Baum und war unsichtbar.
    // Deshalb setzt `Zeitraumfeld` ihn in ein Vollbild-Modal.
    <View testID="kalender" style={{ flex: 1 }}>
      <View testID="kalender-wochentage" style={{ flexDirection: 'row', paddingBottom: spacing.s }}>
        {WOCHENTAGE.map((tag) => (
          <Text
            key={tag}
            style={[type.label, { flex: 1, textAlign: 'center', color: colors['text-2'] }]}
          >
            {tag}
          </Text>
        ))}
      </View>
      <FlatList
        testID="kalender-monate"
        style={{ flex: 1 }}
        data={monate}
        keyExtractor={(m) => `${m.year}-${m.month}`}
        initialScrollIndex={startIndex}
        initialNumToRender={3}
        getItemLayout={(_, index) => ({
          length: monthHeight(monate[index]),
          offset: monthOffset(monate, index),
          index,
        })}
        renderItem={({ item }) => (
          <MonatsBlock
            monat={item}
            auswahl={auswahl}
            onTag={onTag}
            heute={tagHeute}
            ersterTag={ersterTag}
            letzterTag={letzterTag}
          />
        )}
      />
    </View>
  );
}

function MonatsBlock({
  monat, auswahl, onTag, heute, ersterTag, letzterTag,
}: {
  monat: Month;
  auswahl: Selection;
  onTag: (tag: string) => void;
  heute: string;
  ersterTag: string;
  letzterTag: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: MONTH_GAP }}>
      <View style={{ height: MONTH_HEADER_HEIGHT, justifyContent: 'center' }}>
        <Text style={[type.h3, { color: colors['text-1'] }]}>{monat.title}</Text>
      </View>
      {monat.weeks.map((woche, i) => (
        <View key={i} style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
          {woche.map((tag, j) =>
            tag === null ? (
              <View key={`leer-${j}`} style={{ flex: 1 }} />
            ) : (
              <Tageszelle
                key={tag}
                tag={tag}
                rolle={cellRole(tag, auswahl, ersterTag, letzterTag)}
                istHeute={tag === heute}
                onTag={onTag}
              />
            )
          )}
        </View>
      ))}
    </View>
  );
}

function Tageszelle({
  tag, rolle, istHeute, onTag,
}: {
  tag: string;
  rolle: CellRole;
  istHeute: boolean;
  onTag: (tag: string) => void;
}) {
  const { colors } = useTheme();
  const gefuellt = rolle === 'beginn' || rolle === 'ende' || rolle === 'einzeln';
  const gesperrt = rolle === 'gesperrt';
  const zahlFarbe = gefuellt ? colors['bg-0'] : gesperrt ? colors['text-3'] : colors['text-1'];

  // Die Fläche reicht von der Zellmitte bis an die äussere Zellkante, nicht nur
  // bis an den Kreisrand: sonst klafft zwischen dem Beginn und dem ersten Tag
  // der Spanne eine Lücke im Balken.
  const spanne =
    rolle === 'dazwischen' ? { left: 0, right: 0 }
    : rolle === 'beginn' ? { left: '50%' as const, right: 0 }
    : rolle === 'ende' ? { left: 0, right: '50%' as const }
    : null;

  return (
    // Die Spanne liegt NEBEN dem Druckziel, nicht darin. `PressScale` reicht
    // sein `style` an das Pressable weiter, wickelt die Kinder aber in einen
    // Animated.View ohne Style (PressScale.tsx:39), und der schrumpft auf
    // seinen Inhalt, also auf den Kreis. Innen gelegt mass die Fläche deshalb
    // 40 statt der vollen Zellbreite: zwischen zwei Tagen der Spanne klaffte
    // eine Lücke, und die halben Flächen endeten am Kreisrand. Nebenbei
    // skaliert so beim Drücken nur der Kreis, nicht der Balken.
    <View style={{ flex: 1 }}>
      {spanne ? (
        <View
          testID={`spanne-${tag}`}
          style={{
            position: 'absolute',
            top: (ROW_HEIGHT - KREIS) / 2,
            height: KREIS,
            backgroundColor: colors['bg-1'],
            ...spanne,
          }}
        />
      ) : null}
      <PressScale
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        accessibilityRole="button"
        accessibilityLabel={dayLabel(tag)}
        accessibilityState={{ selected: gefuellt || rolle === 'dazwischen', disabled: gesperrt }}
        disabled={gesperrt}
        onPress={() => onTag(tag)}
      >
        <View
          style={{
            width: KREIS,
            height: KREIS,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: gefuellt ? colors['text-1'] : 'transparent',
          }}
        >
          <Text style={[type.body, { color: zahlFarbe }]}>{Number(tag.slice(8))}</Text>
          {istHeute ? (
            <View
              style={{
                position: 'absolute',
                bottom: 6,
                width: 4,
                height: 4,
                borderRadius: radius.pill,
                backgroundColor: gefuellt ? colors['bg-0'] : colors['text-2'],
              }}
            />
          ) : null}
        </View>
      </PressScale>
    </View>
  );
}
