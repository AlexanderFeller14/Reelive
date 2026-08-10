import { Text, View } from 'react-native';
import { Lock, Play } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Badge } from '@/components/Badge';
import { AvatarGroup } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { formatRange } from '@/features/trips/tripDay';
import type { Trip } from '@/features/trips/types';

// Randlose Reise-Karte (DESIGN-LANGUAGE v2 §4): Cover 3:2 mit Radius 24,
// darunter ohne Rahmen und ohne Schatten. Cover-Bilder kommen erst mit
// echten Trip-Covern, bis dahin trägt die Fläche bg-1, in jedem Zustand.
//
// Task 10 (Recap-Tab): zwei Kartenzustände statt einem. `active` bleibt
// unverändert, die Versiegelt-Pille ist reine Symbolik (Icon in `seal`,
// §1: "seal = Versiegelungs-Symbolik") und hängt allein an `trip.status`,
// unabhängig davon, wo die Karte steht. `revealed`/`archived` («entwickelt»,
// Konzept §5.2 "Cover-Collage, «Recap ansehen»-Play-Button") zeigt an
// derselben Stelle stattdessen eine Pille mit Play-Icon in `accent-text`,
// aber NUR, wenn der Aufrufer das per `alsRecap` ausdrücklich anfordert
// (Review Task 10, Important 1). Ohne dieses Flag hätte JEDE aufgedeckte
// Reise überall, wo TripCard steht, «Recap ansehen» getragen, auch in
// reise/index.tsx, wo ein Tipp auf die Karte in den Reise-Detail-Screen
// führt, nicht in den Recap. Die Pille wäre dort ein Versprechen gewesen,
// das der Tipp nicht einlöst. Der Recap-Tab (die einzige Stelle, an der ein
// Tipp tatsächlich die Übersicht öffnet) setzt `alsRecap`, der Reise-Tab
// lässt es weg und zeigt aufgedeckte Reisen weiterhin ohne jede Pille,
// genau der Stand vor diesem Task.
//
// `accent` statt `seal`, weil das Antippen dort, wo die Pille steht, eine
// Interaktion ist, keine Symbolik (§1: "accent = Interaktion, seal =
// Versiegelungs-Symbolik. Nie mischen."). Die Pille liegt unter derselben
// PressScale wie die ganze Karte und ist kein eigenes Tap-Ziel, sie zeigt
// nur an, was ein Tipp auf die Karte auslöst (Übersicht).
export function TripCard({
  trip, onPress, alsRecap = false,
}: {
  trip: Trip;
  onPress: () => void;
  alsRecap?: boolean;
}) {
  const { colors } = useTheme();
  const momente = `${trip.my_post_count} ${trip.my_post_count === 1 ? 'Moment' : 'Momente'}`;
  const aufgedeckt = alsRecap && trip.status !== 'active';

  return (
    <PressScale scaleTo={0.98} accessibilityRole="button" onPress={onPress}>
      <View style={{ gap: spacing.m }}>
        <View
          style={{
            aspectRatio: 3 / 2,
            borderRadius: radius.card,
            backgroundColor: colors['bg-1'],
            justifyContent: 'flex-start',
            padding: spacing.m,
          }}
        >
          {trip.status === 'active' && (
            <Badge label="Versiegelt" tone="seal" icon={<Lock size={12} color={colors.seal} strokeWidth={1.75} />} />
          )}
          {aufgedeckt && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                alignSelf: 'flex-start',
                paddingHorizontal: spacing.m,
                paddingVertical: spacing.xs,
                borderRadius: radius.pill,
                backgroundColor: colors['bg-1'],
              }}
            >
              <Play size={12} color={colors['accent-text']} strokeWidth={1.75} />
              <Text style={[type.label, { color: colors['accent-text'] }]}>Recap ansehen</Text>
            </View>
          )}
        </View>
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{trip.name}</Text>
          <Text style={[type.secondary, { color: colors['text-2'] }]}>
            {formatRange(trip.start_date, trip.end_date)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m, marginTop: spacing.xs }}>
            <AvatarGroup names={trip.member_names} />
            <Text style={[type.secondary, { color: colors['text-2'] }]}>{momente}</Text>
          </View>
        </View>
      </View>
    </PressScale>
  );
}
