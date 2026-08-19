// Content of the "share recap" sheet (Task-6-brief), mounted into
// recap/[id]/uebersicht.tsx via <Sheet kino>. A separate component instead
// of a local sub-building-block directly in uebersicht.tsx (unlike e.g.
// TagesAbschnitt there): the state machine here (load, create, revoke,
// expiry choice, copy, share) is big enough that it stays clearer in its
// own file with its own tests than as yet another nested branch in an
// already 300-line screen.
//
// HONESTY FIRST (brief, verbatim: "The sheet says this before anyone
// shares, not after."): the hint that a link shows the WHOLE recap without
// an account appears in EVERY phase where any action at all is already
// possible (kein_link AND link_aktiv), not only after a link exists.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, Share2 } from 'lucide-react-native';
import { Pill } from '@/components/Pill';
import { PressScale } from '@/components/PressScale';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { createLink, fetchActiveLink, revokeLink, type ActiveLink } from './linkManagementApi';
import { LINK_REACH_TEXT } from './texts';

// Three fixed options (brief) instead of a free input field, a typo in a
// validity duration is a bad place for a number input.
const EXPIRY_OPTIONS: { id: string; label: string; days: number | null }[] = [
  { id: '7', label: '7 Tage', days: 7 },
  { id: '30', label: '30 Tage', days: 30 },
  { id: 'unbegrenzt', label: 'Unbegrenzt', days: null },
];

// The same sentence the trip screen also shows for as long as a link
// exists. It lives in features/sharing/texts.ts, the reasoning is there.
const DISCLOSURE_TEXT = LINK_REACH_TEXT;
const LOAD_ERROR = 'Der Teilen-Link konnte nicht geladen werden. Probier es gleich nochmal.';

type Phase = 'laedt' | 'kein_link' | 'link_aktiv' | 'fehler';

function CinemaPrimaryButton({
  label, onPress, loading, testID,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  testID?: string;
}) {
  return (
    <PressScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!loading }}
      onPress={() => {
        if (!loading) onPress();
      }}
    >
      <View style={styles.primaryButton}>
        {loading ? (
          <ActivityIndicator color={palette['on-accent']} size="small" />
        ) : (
          <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>{label}</Text>
        )}
      </View>
    </PressScale>
  );
}

// Active fills SOLID with `cinema['text-1']`, the same tone `KinoButton`
// (player.tsx) uses for "solid surface on cinema background", no new
// value. IMPORTANT, unlike the model EmojiPille (player.tsx): EmojiPille
// fills the same area with an emoji whose own colors stay distinct from
// any background, here real text sits on top, which would go invisible
// with `cinema['text-1']` on `cinema['text-1']` (final review point 1).
// The text therefore needs the counter color: `cinema['bg-0']`, exactly as
// `KinoButton` uses it for its own label on the same fill (player.tsx:
// `{ color: cinema['bg-0'] }` on `backgroundColor: cinema['text-1']`).
//
// Inactive, the pill stays translucent + blur (DESIGN-LANGUAGE §1/§4,
// Task 10), BUT: §1 explicitly reserves that recipe for UI "on photos".
// This sheet sits on no photo, but on the opaque `cinema['bg-1']` surface
// of Sheet.tsx, where the tint `overlay-pille` (`rgba(19,17,16,0.55)`)
// blends into the background almost invisibly (final review point 1,
// "contrast of about 5/255": both surfaces live in the same dark color
// space). A 1px border in `cinema['text-2']` traces the pill shape
// anyway, the same token Sheet.tsx already uses as the cinema substitute
// for `line-strong` (grabber), see there.
function ExpiryPill({
  id, label, active, onPress,
}: {
  id: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressScale
      testID={`teilen-ablauf-${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
      {active ? (
        <View style={[styles.expiryPill, styles.expiryPillActive]}>
          <Text style={[type.secondary, { color: cinema['bg-0'] }]}>{label}</Text>
        </View>
      ) : (
        <Pill style={styles.expiryPill}>
          <Text style={[type.secondary, { color: cinema['text-1'] }]}>{label}</Text>
        </Pill>
      )}
    </PressScale>
  );
}

export function ShareSheetContent({ tripId }: { tripId: string }) {
  const [phase, setPhase] = useState<Phase>('laedt');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [link, setLink] = useState<ActiveLink | null>(null);
  const [validDays, setValidDays] = useState<number | null>(7);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setPhase('laedt');
    setLoadError(null);
    const { data, error } = await fetchActiveLink(tripId);
    if (!mounted.current) return;
    if (error) {
      setLoadError(error);
      setPhase('fehler');
      return;
    }
    if (data) {
      setLink(data);
      setPhase('link_aktiv');
    } else {
      setPhase('kein_link');
    }
  }, [tripId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [load]);

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    const { data, error } = await createLink(tripId, validDays);
    if (!mounted.current) return;
    setCreating(false);
    if (error || !data) {
      setCreateError(error ?? LOAD_ERROR);
      return;
    }
    setLink(data);
    setPhase('link_aktiv');
  };

  const copy = async () => {
    if (!link) return;
    try {
      await Clipboard.setStringAsync(link.url);
    } catch {
      // expo-clipboard practically never fails, no silent crash, but also
      // no dedicated error message for it: the link stays visible and can
      // be selected by hand if needed.
      return;
    }
    if (!mounted.current) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      if (mounted.current) setCopied(false);
    }, 2000);
  };

  const share = async () => {
    if (!link) return;
    try {
      // `message` instead of `url`: Android doesn't reliably honor the
      // `url` field of Share.share (a widespread limitation of the
      // platform API), `message` works the same on both platforms.
      await Share.share({ message: link.url });
    } catch {
      // A canceled/failed system dialog is not an app error, the link
      // stays visible unchanged and can still be shared via "Copy".
    }
  };

  const revoke = () => {
    if (!link) return;
    const token = link.token;
    Alert.alert('Link deaktivieren?', 'Wer den Link hat, kommt danach nicht mehr an den Recap.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Deaktivieren',
        style: 'destructive',
        onPress: () => {
          setRevoking(true);
          setRevokeError(null);
          void revokeLink(token).then(({ error }) => {
            if (!mounted.current) return;
            setRevoking(false);
            if (error) {
              setRevokeError(error);
              return;
            }
            setLink(null);
            setValidDays(7);
            setPhase('kein_link');
          });
        },
      },
    ]);
  };

  if (phase === 'laedt') {
    return (
      <View testID="teilen-sheet-laedt" style={styles.center}>
        <ActivityIndicator color={cinema['text-1']} />
      </View>
    );
  }

  if (phase === 'fehler') {
    return (
      <View testID="teilen-sheet-fehler" style={{ gap: spacing.base }}>
        <Text style={[type.body, { color: palette.danger }]}>{loadError}</Text>
        <CinemaPrimaryButton label="Nochmal versuchen" onPress={() => void load()} testID="teilen-nochmal" />
      </View>
    );
  }

  if (phase === 'link_aktiv' && link) {
    return (
      <View style={{ gap: spacing.base }}>
        <Text style={[type.secondary, { color: cinema['text-2'] }]}>{DISCLOSURE_TEXT}</Text>
        <Text testID="teilen-link-text" style={[type.body, { color: cinema['text-1'] }]} selectable>
          {link.url}
        </Text>
        <View style={styles.actionRow}>
          <PressScale
            testID="teilen-kopieren"
            accessibilityRole="button"
            accessibilityLabel="Link kopieren"
            onPress={() => void copy()}
          >
            <Pill style={styles.pillButton}>
              <Copy size={18} color={cinema['text-1']} strokeWidth={1.75} />
              <Text style={[type.bodyMedium, { color: cinema['text-1'] }]}>
                {copied ? 'Kopiert' : 'Kopieren'}
              </Text>
            </Pill>
          </PressScale>
          <PressScale
            testID="teilen-teilen"
            accessibilityRole="button"
            accessibilityLabel="Teilen"
            onPress={() => void share()}
          >
            <View style={styles.pillButtonAccent}>
              <Share2 size={18} color={palette['on-accent']} strokeWidth={1.75} />
              <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Teilen</Text>
            </View>
          </PressScale>
        </View>
        {revokeError && (
          <Text style={[type.secondary, { color: palette.danger }]}>{revokeError}</Text>
        )}
        <PressScale
          testID="teilen-deaktivieren"
          accessibilityRole="button"
          accessibilityState={{ disabled: revoking }}
          onPress={() => {
            if (!revoking) revoke();
          }}
        >
          {revoking ? (
            <ActivityIndicator color={palette.danger} size="small" />
          ) : (
            <Text style={[type.bodyMedium, styles.revokeText]}>Link deaktivieren</Text>
          )}
        </PressScale>
      </View>
    );
  }

  // phase === 'kein_link'
  return (
    <View style={{ gap: spacing.base }}>
      <Text style={[type.secondary, { color: cinema['text-2'] }]}>{DISCLOSURE_TEXT}</Text>
      <View style={{ gap: spacing.xs }}>
        <Text style={[type.secondary, { color: cinema['text-2'] }]}>Wie lange soll der Link gelten?</Text>
        <View style={styles.expiryRow}>
          {EXPIRY_OPTIONS.map((option) => (
            <ExpiryPill
              key={option.id}
              id={option.id}
              label={option.label}
              active={validDays === option.days}
              onPress={() => setValidDays(option.days)}
            />
          ))}
        </View>
      </View>
      {createError && <Text style={[type.secondary, { color: palette.danger }]}>{createError}</Text>}
      <CinemaPrimaryButton
        label="Link erstellen"
        loading={creating}
        onPress={() => void create()}
        testID="teilen-erstellen"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  primaryButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
  },
  expiryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  // Border in `cinema['text-2']` (reasoning see comment above ExpiryPill):
  // the translucent pill alone nearly disappears on the opaque sheet
  // surface, the border traces the shape anyway. On the ACTIVE variant
  // (expiryPillActive, solid fill) the same border barely stands out, but
  // doesn't hurt there either, a second style conditioned on `active`
  // would be more surface for the same effect.
  expiryPill: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: cinema['text-2'],
  },
  expiryPillActive: { backgroundColor: cinema['text-1'] },
  actionRow: { flexDirection: 'row', gap: spacing.s },
  // Same border reasoning as expiryPill: "Copy" is the only other
  // translucent `Pille` on this sheet surface (final review point 1),
  // "Share" next to it (pillButtonAccent) is already a solid
  // `palette.accent` surface and needs no border.
  pillButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: cinema['text-2'],
  },
  pillButtonAccent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 52,
    borderRadius: radius.control,
    backgroundColor: palette.accent,
  },
  revokeText: { color: palette.danger, textDecorationLine: 'underline', textAlign: 'center' },
});
