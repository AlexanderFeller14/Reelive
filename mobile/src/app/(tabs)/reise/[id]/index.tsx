import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, X } from 'lucide-react-native';
import { PressScale } from '@/components/PressScale';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import { useAuth } from '@/features/auth/AuthProvider';
import { deleteTrip, fetchMembers, fetchTrip, removeMember } from '@/features/trips/tripsApi';
import { formatRange, tripDay, tripLength } from '@/features/trips/tripDay';
import type { Trip, TripMember } from '@/features/trips/types';

export default function ReiseDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [mitglieder, setMitglieder] = useState<TripMember[]>([]);
  // Schirmt setState nach Blur/Unmount ab — gleiches Muster wie in der
  // Listen-Schwesterdatei (reise/index.tsx): jeder Fokus-Zyklus bekommt seinen
  // eigenen Wächter, der beim Verlassen des Screens auf false gesetzt wird, damit
  // eine spät auflösende Ladeoperation keinen State mehr auf einen weggeklickten
  // Screen schreibt.
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    const [t, m] = await Promise.all([fetchTrip(id), fetchMembers(id)]);
    if (!aktiv.current) return;
    setTrip(t);
    setMitglieder(m);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      aktiv.current = true;
      void laden();
      return () => {
        aktiv.current = false;
      };
    }, [laden])
  );

  if (!trip) return <View style={{ flex: 1, backgroundColor: colors['bg-0'] }} />;

  const istOwner = trip.owner_id === userId;
  const laeuft = trip.status === 'active';
  const heute = new Date().toISOString().slice(0, 10);
  const tag = tripDay(trip.start_date, heute);
  const laenge = tripLength(trip.start_date, trip.end_date);

  const entfernen = (m: TripMember) => {
    Alert.alert(`${m.display_name} entfernen?`, 'Bereits eingesendete Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          void removeMember(id, m.user_id).then(({ error }) => {
            if (error) return Alert.alert('Nicht entfernt', error);
            void laden();
          });
        },
      },
    ]);
  };

  const verlassen = () => {
    Alert.alert('Reise verlassen?', 'Deine bereits eingesendeten Momente bleiben in der Reise.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: () => {
          if (!userId) return;
          void removeMember(id, userId).then(({ error }) => {
            if (error) return Alert.alert('Nicht verlassen', error);
            router.replace('/reise');
          });
        },
      },
    ]);
  };

  const loeschen = () => {
    Alert.alert('Reise löschen?', 'Die Reise und alle Momente darin verschwinden für alle.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          void deleteTrip(id).then(({ error }) => {
            if (error) return Alert.alert('Nicht gelöscht', error);
            router.replace('/reise');
          });
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: colors['bg-0'] }} contentContainerStyle={styles.inhalt}>
      <View style={{ aspectRatio: 3 / 2, borderRadius: radius.card, backgroundColor: colors['bg-1'], padding: spacing.m }}>
        {laeuft && (
          <Badge label="Versiegelt" tone="seal" icon={<Lock size={12} color={colors.seal} strokeWidth={1.75} />} />
        )}
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>{trip.name}</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          {formatRange(trip.start_date, trip.end_date)}
        </Text>
        {laeuft && tag > 0 && (
          <Text style={[type.secondary, { color: colors['text-2'] }]}>{`Tag ${tag} von ${laenge}`}</Text>
        )}
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[type.display, { color: colors['text-1'] }]}>{String(trip.my_post_count)}</Text>
        <Text style={[type.body, { color: colors['text-2'] }]}>
          Momente eingefangen — bis zum Recap versiegelt.
        </Text>
      </View>

      <View style={{ gap: spacing.m }}>
        <Text style={[type.h2, { color: colors['text-1'] }]}>Wer dabei ist</Text>
        {mitglieder.map((m) => (
          <View key={m.user_id} style={styles.zeile}>
            <Avatar name={m.display_name} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>{m.display_name}</Text>
              <Text style={[type.secondary, { color: colors['text-2'] }]}>
                {m.role === 'owner' ? 'Hat die Reise angelegt' : `@${m.username}`}
              </Text>
            </View>
            {istOwner && m.user_id !== userId && (
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={`${m.display_name} entfernen`}
                onPress={() => entfernen(m)}
              >
                <X size={20} color={colors['text-2']} strokeWidth={1.75} />
              </PressScale>
            )}
          </View>
        ))}
      </View>

      {istOwner && laeuft && (
        <Button variant="primary" label="Freunde einladen" onPress={() => router.push(`/reise/${id}/einladen`)} />
      )}
      {istOwner && (
        <Button variant="secondary" label="Reise bearbeiten" onPress={() => router.push(`/reise/${id}/bearbeiten`)} />
      )}
      <Button
        variant="text"
        label={istOwner ? 'Reise löschen' : 'Reise verlassen'}
        onPress={istOwner ? loeschen : verlassen}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  inhalt: { padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.xl },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
});
