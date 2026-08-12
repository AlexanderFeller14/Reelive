import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import {
  heuteOderDefault, monatHoehe, monatIndexFuer, monatVersatz, monateImBereich,
  tagLabel, zellrolle, MONAT_ABSTAND, MONAT_KOPF_HOEHE, ZEILE_HOEHE,
  type Auswahl, type Monat, type Zellrolle,
} from '@/features/trips/kalender';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Der sichtbare Kreis ist kleiner als seine Zelle: die Zelle ist das Touch-Ziel
// und misst ZEILE_HOEHE mal ein Siebtel der Rasterbreite, beides über den 44 px
// aus Apples Human Interface Guidelines. Ein fester Durchmesser bleibt zudem
// unabhängig von der Gerätebreite ein Kreis statt eines Ovals.
const KREIS = 40;

type Props = {
  auswahl: Auswahl;
  onTag: (tag: string) => void;
  // Ohne diesen Einstieg hinge jeder Test am echten Systemdatum und bräche im
  // Folgemonat (gleiches Muster wie heutigerKalendertag(jetzt = new Date())).
  heute?: string;
};

export function Kalender({ auswahl, onTag, heute }: Props) {
  const { colors } = useTheme();
  const tagHeute = heuteOderDefault(heute);
  const monate = useMemo(() => monateImBereich(tagHeute), [tagHeute]);
  const ersterTag = monate[0].wochen.flat().find(Boolean) as string;
  const letzterTag = monate[monate.length - 1].wochen.flat().filter(Boolean).pop() as string;

  // Nur der erste Rendervorgang springt, danach scrollt der Nutzer selbst.
  // Als Lazy-Initializer statt als Ref: der Wert wird genau einmal berechnet
  // und bleibt danach konstant, ohne dass währenddessen ein Ref gelesen wird.
  const [startIndex] = useState(() => monatIndexFuer(monate, auswahl.start ?? tagHeute));

  return (
    <View style={{ flex: 1 }}>
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
        data={monate}
        keyExtractor={(m) => `${m.jahr}-${m.monat}`}
        initialScrollIndex={startIndex}
        initialNumToRender={3}
        getItemLayout={(_, index) => ({
          length: monatHoehe(monate[index]),
          offset: monatVersatz(monate, index),
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
  monat: Monat;
  auswahl: Auswahl;
  onTag: (tag: string) => void;
  heute: string;
  ersterTag: string;
  letzterTag: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: MONAT_ABSTAND }}>
      <View style={{ height: MONAT_KOPF_HOEHE, justifyContent: 'center' }}>
        <Text style={[type.h3, { color: colors['text-1'] }]}>{monat.titel}</Text>
      </View>
      {monat.wochen.map((woche, i) => (
        <View key={i} style={{ flexDirection: 'row', height: ZEILE_HOEHE }}>
          {woche.map((tag, j) =>
            tag === null ? (
              <View key={`leer-${j}`} style={{ flex: 1 }} />
            ) : (
              <Tageszelle
                key={tag}
                tag={tag}
                rolle={zellrolle(tag, auswahl, ersterTag, letzterTag)}
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
  rolle: Zellrolle;
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
    <PressScale
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="button"
      accessibilityLabel={tagLabel(tag)}
      accessibilityState={{ selected: gefuellt || rolle === 'dazwischen', disabled: gesperrt }}
      disabled={gesperrt}
      onPress={() => onTag(tag)}
    >
      {spanne ? (
        <View
          style={{
            position: 'absolute',
            top: (ZEILE_HOEHE - KREIS) / 2,
            height: KREIS,
            backgroundColor: colors['bg-1'],
            ...spanne,
          }}
        />
      ) : null}
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
  );
}
