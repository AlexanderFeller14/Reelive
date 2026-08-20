import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, Switch, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Pencil } from 'lucide-react-native';
import { Avatar } from '@/components/Avatar';
import { AvatarSheetContent, AvatarPicker } from '@/components/AvatarPicker';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { PressScale } from '@/components/PressScale';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { motion, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { useAuth } from '@/features/auth/AuthProvider';
import { AvatarCropper } from '@/components/AvatarCropper';
import { Input } from '@/components/Input';
import { removeAvatar, setAvatar } from '@/features/auth/avatarApi';
import type { Crop } from '@/features/auth/crop';
import {
  fetchOwnProfile, updateProfile, validateDisplayName, type Profile,
} from '@/features/auth/profileApi';
import { signOut } from '@/features/auth/authApi';
import { wifiOnly, setWifiOnly } from '@/features/moments/settings';
import { notificationsActive, setNotificationsActive } from '@/features/push/settings';
import { deregisterPushToken, registerPushToken } from '@/features/push/pushApi';
import { fetchDeletionCounts, deleteAccount, deletionSummaryText, type DeletionCounts } from '@/features/account/accountApi';

// Task 9, phase 6: the destructive confirmation button in the delete dialog.
// No filled button (DESIGN-LANGUAGE §4 knows only `accent` as a surface for a
// primary button, a second hard-wired fill tone would have no basis in the
// styleguide), instead the same outline archetype as
// `Button variant="secondary"`, only tinted `danger` instead of `text-1`.
// Same reasoning as the danger text links that already exist
// (ShareSheetContent "Link deaktivieren", ReportRow "Moment entfernen").
function DangerButton({
  label, onPress, disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <PressScale
      testID="delete-account-confirm"
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={() => {
        if (!disabled) onPress();
      }}
    >
      <View style={[styles.dangerButton, { borderColor: colors.danger }]}>
        {disabled ? (
          <ActivityIndicator testID="delete-account-loading" color={colors.danger} size="small" />
        ) : (
          <Text style={[type.bodyMedium, { color: colors.danger }]}>{label}</Text>
        )}
      </View>
    </PressScale>
  );
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  // The screen is read from top to bottom now (image, name, settings) rather
  // than centred vertically, so it uses the same top inset as the trip and
  // recap tabs: the image must not slide behind the status bar or the
  // Dynamic Island.
  //
  // Plus one grid step (§3: 4 · 8 · 12 · 16 · 24 · 32 · 48) on top, because
  // the cut-out header image starts without a frame and therefore looks
  // higher than a card at the same edge. ADDED rather than used as a larger
  // base: `useTopInset` takes the maximum of base and system area, and on
  // devices with an island that is already larger anyway (59 + 16), so a base
  // of 48 instead of 32 would have no effect there.
  const topInset = useTopInset(spacing.xl) + spacing.l;
  const { userId } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wifiOnlyEnabled, setWifiOnlyEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  const [deleteSheetVisible, setDeleteSheetVisible] = useState(false);
  const [countsState, setCountsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [counts, setCounts] = useState<DeletionCounts | null>(null);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [imageSheetVisible, setImageSheetVisible] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<
    { uri: string; width: number; height: number } | null
  >(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // "Anzeigename ändern" is NOT a bottom sheet but a full-screen overlay like
  // the AvatarCropper (device finding plus decision 2026-08-13): in a sheet
  // at the lower edge the input fields sat exactly where the keyboard
  // stands. Full screen puts them at the top and the keyboard has the space
  // below to itself. The USERNAME deliberately has no field here (decision
  // 2026-08-13, reasoning at updateProfile in profileApi.ts): fixed until
  // there is a server-side brake.
  const [nameEditorVisible, setNameEditorVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [displayNameError, setDisplayNameError] = useState<string | undefined>();
  const [nameFormError, setNameFormError] = useState<string | null>(null);
  const [nameLoading, setNameLoading] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  // The saving moment (§5, micro-interaction, NO staging: the 700 to 900 ms
  // stay reserved for sealing and reveal): one progress value drives the pop
  // of the preview card (interpolation 1 to 1.05 to 1, the same pattern as
  // sealScale in SealAnimation.tsx), afterwards the editor fades out with
  // duration-base. Both as Animated.Value in state, the way PressScale and
  // Sheet hold theirs.
  const [momentPop] = useState(() => new Animated.Value(0));
  const [editorOpacity] = useState(() => new Animated.Value(1));
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (userId) void fetchOwnProfile(userId).then(setProfile);
  }, [userId]);

  // Task 10: the stored state loads once on opening. The screen has no
  // focus-refresh pattern like trip/[id]/index.tsx, because nothing outside
  // the app itself can change these values. Applies to both switches alike.
  useEffect(() => {
    void wifiOnly().then(setWifiOnlyEnabled);
    void notificationsActive().then(setNotificationsEnabled);
  }, []);

  // Visible immediately (no waiting on the write): a write error left behind
  // in AsyncStorage must not make the switch spring back, see settings.ts.
  const toggleWifiOnly = (value: boolean) => {
    setWifiOnlyEnabled(value);
    void setWifiOnly(value);
  };

  const toggleNotifications = async (value: boolean) => {
    setNotificationsEnabled(value);
    setPushNotice(null);
    await setNotificationsActive(value);
    if (!value) {
      void deregisterPushToken();
      return;
    }
    if (!userId) return;
    const result = await registerPushToken(userId);
    if (result === 'no_permission') {
      setNotificationsEnabled(false);
      await setNotificationsActive(false);
      setPushNotice('Ohne Zugriff auf Mitteilungen geht es nicht. Du kannst das in den Einstellungen ändern.');
    }
  };

  const openDeleteAccount = () => {
    setDeleteSheetVisible(true);
    setCountsState('loading');
    setCounts(null);
    setCountsError(null);
    setDeleteError(null);
    void fetchDeletionCounts().then(({ data, error }) => {
      if (error || !data) {
        setCountsError(error ?? 'Die Zahlen konnten nicht ermittelt werden. Probier es gleich nochmal.');
        setCountsState('error');
        return;
      }
      setCounts(data);
      setCountsState('ready');
    });
  };

  const closeDeleteAccount = () => setDeleteSheetVisible(false);

  // signOut() additionally cleans up the push token (an RLS delete that hits
  // zero rows after a successful account deletion anyway, no error, DELETE is
  // idempotent) and signs out locally; the navigation itself is then handled
  // by the global guard in the root layout (resolveRoute('signedOut') to
  // '/welcome'), exactly as with the ordinary sign-out button below, so no
  // second, redundant router.replace() here.
  const confirmDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await deleteAccount();
    if (error) {
      setDeleting(false);
      setDeleteError(error);
      return;
    }
    await signOut();
  };

  const setImage = async (uri: string, crop: Crop) => {
    if (!userId) return;
    setImageLoading(true);
    setImageError(null);
    const { avatarKey, error } = await setAvatar(
      userId, uri, profile?.avatar_key ?? null, crop,
    );
    setImageLoading(false);
    if (error) return setImageError(error);
    setProfile((previous) => (previous ? { ...previous, avatar_key: avatarKey } : previous));
  };

  const removeImage = async () => {
    if (!userId) return;
    setImageLoading(true);
    setImageError(null);
    const { error } = await removeAvatar(userId, profile?.avatar_key ?? null);
    setImageLoading(false);
    if (error) return setImageError(error);
    setProfile((previous) => (previous ? { ...previous, avatar_key: null } : previous));
  };

  const openNameEditor = () => {
    if (!profile) return;
    setNameDraft(profile.display_name);
    setDisplayNameError(undefined);
    setNameFormError(null);
    // The editor stays mounted when it closes (the screen only renders
    // `visible=false`), so the Animated values survive. Without this reset
    // the next opening started invisible or halfway through the pop (the
    // same trap as the swipe offset in Sheet.tsx).
    momentPop.setValue(0);
    editorOpacity.setValue(1);
    setNameLoading(false);
    setNameSaved(false);
    setNameEditorVisible(true);
  };

  const saveName = async () => {
    if (!userId) return;
    const dErr = validateDisplayName(nameDraft);
    setDisplayNameError(dErr ?? undefined);
    setNameFormError(null);
    if (dErr) return;
    setNameLoading(true);
    const { error } = await updateProfile(userId, nameDraft);
    if (error) {
      setNameLoading(false);
      return setNameFormError(error);
    }
    setProfile((previous) => (previous
      ? { ...previous, display_name: nameDraft.trim() }
      : previous));
    setNameLoading(false);
    setNameSaved(true);
    const close = () => setNameEditorVisible(false);
    // A holding phase after the pop (wish from 2026-08-14): the checkmark
    // should stand for one breath before the screen changes, otherwise the
    // success feels torn away. `gentle` instead of an invented value; the
    // stillness does not count as motion, so it applies in the
    // reduced-motion branch too, before its 200 ms fade.
    const hold = Animated.delay(motion.duration.gentle);
    const fadeOut = (duration: number) => Animated.timing(editorOpacity, {
      toValue: 0,
      duration,
      easing: Easing.bezier(...motion.easeSmooth),
      useNativeDriver: true,
    });
    if (reducedMotion) {
      // §5: everything becomes a 200 ms fade, no pop.
      Animated.sequence([hold, fadeOut(200)]).start(close);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.sequence([
      Animated.timing(momentPop, {
        toValue: 1,
        duration: motion.duration.gentle,
        easing: Easing.bezier(...motion.easeSmooth),
        useNativeDriver: true,
      }),
      hold,
      fadeOut(motion.duration.base),
    ]).start(close);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-0'] }}>
      {/* Scrollable instead of a fixed height: with the image above it the
          content grows longer than the screen on small devices, and the
          destructive zone at the bottom must never end up out of sight. */}
      <ScrollView testID="profile-content" contentContainerStyle={[styles.content, { paddingTop: topInset }]}>
        <View style={styles.headerImage}>
          <AvatarPicker
            large
            name={profile?.display_name ?? ''}
            avatarKey={profile?.avatar_key ?? null}
            loading={imageLoading}
            onOpen={() => setImageSheetVisible(true)}
          />
        </View>
        {imageError && (
          <Text style={[type.secondary, { color: colors.danger }]}>{imageError}</Text>
        )}
        {/* `styles.row`/`rowText` instead of separate profile-only styles:
            image left, text right is exactly the same row shape as the wifi
            card below, equal down to the token (`spacing.m` outside,
            `spacing.xs` inside). Two stylesheet entries with identical
            contents would not be a second meaning, only a second name for
            the same one.

            The whole card is the tap target for editing the name: since the
            image swap it contains no tap target of its own (the image picker
            sits above), and a second one inside would cut it in two (same
            reasoning as the trip card in Avatar.tsx). */}
        <PressScale
          testID="name-edit-open"
          accessibilityRole="button"
          accessibilityLabel="Anzeigename ändern"
          onPress={openNameEditor}
        >
          <Card style={styles.row}>
            <Image
              testID="profile-passport"
              source={require('@/assets/images/reisepass-rot-transparent.png')}
              style={styles.passport}
              contentFit="contain"
              accessible={false}
            />
            <View style={styles.rowText}>
              <Text style={[type.h1, { color: colors['text-1'] }]}>{profile?.display_name ?? '…'}</Text>
              <Text style={[type.secondary, { color: colors['text-2'] }]}>
                {profile ? `@${profile.username}` : ''}
              </Text>
            </View>
            {/* The pencil says "something can be changed here", the same role
                as the camera badge on the profile image above. Lucide
                outline, never emoji (§7); in text-2, because it is a hint,
                not an action. In a View wrapper like the badge in
                AvatarPicker.tsx: Lucide does not pass testID through to the
                rendered node. */}
            <View testID="name-edit-pencil">
              <Pencil size={20} color={colors['text-2']} strokeWidth={1.75} />
            </View>
          </Card>
        </PressScale>
        <Card style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Nur über WLAN einsenden</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>
              Spart mobile Daten. Deine Momente warten, bis du wieder im WLAN bist.
            </Text>
          </View>
          <Switch
            value={wifiOnlyEnabled}
            onValueChange={toggleWifiOnly}
            trackColor={{ false: colors['bg-1'], true: colors.accent }}
            thumbColor={colors['bg-0']}
            accessibilityLabel="Nur über WLAN einsenden"
          />
        </Card>
        <Card style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[type.bodyMedium, { color: colors['text-1'] }]}>Benachrichtigungen</Text>
            <Text style={[type.secondary, { color: colors['text-2'] }]}>
              Sagt dir Bescheid, wenn in deinen Reisen etwas passiert.
            </Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={(value) => void toggleNotifications(value)}
            trackColor={{ false: colors['bg-1'], true: colors.accent }}
            thumbColor={colors['bg-0']}
            accessibilityLabel="Benachrichtigungen"
          />
        </Card>
        {pushNotice && (
          <Text style={[type.secondary, { color: colors.danger }]}>{pushNotice}</Text>
        )}
        <Button variant="secondary" label="Abmelden" onPress={() => void signOut()} />

        {/* Task 9: spacing of its own, so the destructive zone visibly sets
            itself apart from the rest without introducing a second
            surface or card. */}
        <PressScale
          testID="delete-account-open"
          accessibilityRole="button"
          onPress={openDeleteAccount}
        >
          <Text style={[type.bodyMedium, styles.deleteAccountText, { color: colors.danger }]}>
            Konto löschen
          </Text>
        </PressScale>
      </ScrollView>

      {/* Both sheets are siblings of the ScrollView, not its children: a
          sheet lays itself over its parent via StyleSheet.absoluteFill, so
          inside the scroll content it would sit against the content instead
          of against the screen. The image sheet hung in the circle wrapper of
          the card above until the merge fix round and was 44 px wide there,
          the full reasoning is in AvatarPicker.tsx. */}
      <Sheet visible={imageSheetVisible} title="Profilbild" onClose={() => setImageSheetVisible(false)}>
        <AvatarSheetContent
          avatarKey={profile?.avatar_key ?? null}
          onSelected={(uri, width, height) => setImageToCrop({ uri, width, height })}
          onRemove={() => void removeImage()}
          onClose={() => setImageSheetVisible(false)}
        />
      </Sheet>

      {/* "Anzeigename ändern" as a full-screen overlay (reasoning at the
          state above): the same pattern as the AvatarCropper below it, only
          bright instead of cinema, because a form stands here and not a
          photo (§1). The field sits at the top and the keyboard has the rest
          of the screen to itself. */}
      {nameEditorVisible && (
        <Animated.View
          testID="name-editor"
          style={[styles.nameEditor, { backgroundColor: colors['bg-0'], opacity: editorOpacity }]}
        >
          <View style={[styles.nameEditorContent, { paddingTop: topInset }]}>
            <Text style={[type.h1, { color: colors['text-1'] }]}>Anzeigename ändern</Text>
            {/* A live preview rather than decoration: the row as friends see
                it (circle, name, handle, the same shape as the member row),
                with the TYPED state instead of the stored one. ABOVE the
                field (wish from 2026-08-13): see what you are changing
                first, then change it, and the field still stays high enough
                to keep clear of the keyboard. */}
            <View style={styles.previewZone}>
              <Text style={[type.secondary, { color: colors['text-2'] }]}>
                So sehen dich deine Freunde.
              </Text>
              {/* The pop of the saving moment: 1 to 1.05 to 1 across half the
                  progress, interpolation instead of two chained springs (the
                  same pattern as sealScale in SealAnimation.tsx). */}
              <Animated.View
                style={{
                  transform: [{
                    scale: momentPop.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [1, 1.05, 1],
                    }),
                  }],
                }}
              >
                <Card testID="name-preview" style={styles.row}>
                  <Avatar name={nameDraft} avatarKey={profile?.avatar_key ?? null} size={44} />
                  <View style={styles.rowText}>
                    <Text style={[type.h1, { color: colors['text-1'] }]}>
                      {nameDraft.trim() || '…'}
                    </Text>
                    <Text style={[type.secondary, { color: colors['text-2'] }]}>
                      {profile ? `@${profile.username}` : ''}
                    </Text>
                  </View>
                </Card>
              </Animated.View>
            </View>
            <Input
              label="Anzeigename"
              value={nameDraft}
              onChangeText={setNameDraft}
              error={displayNameError}
            />
            {nameFormError && (
              <Text style={[type.body, { color: colors.danger }]}>{nameFormError}</Text>
            )}
            <Button
              variant="primary"
              label="Speichern"
              onPress={() => void saveName()}
              loading={nameLoading}
              success={nameSaved}
            />
            <Button
              variant="secondary"
              label="Abbrechen"
              onPress={() => setNameEditorVisible(false)}
              disabled={nameLoading || nameSaved}
            />
          </View>
        </Animated.View>
      )}

      {/* The cropper lies over everything and is therefore the last node:
          `allowsEditing` had to go from the image picker (it made large
          images fail), so the crop rect is chosen here. */}
      {imageToCrop && (
        <AvatarCropper
          uri={imageToCrop.uri}
          width={imageToCrop.width}
          height={imageToCrop.height}
          onCancel={() => setImageToCrop(null)}
          onDone={(rect) => {
            const chosen = imageToCrop;
            setImageToCrop(null);
            void setImage(chosen.uri, rect);
          }}
        />
      )}

      <Sheet visible={deleteSheetVisible} title="Konto löschen?" onClose={closeDeleteAccount}>
        {countsState === 'loading' && (
          <View style={styles.countsLoading}>
            <ActivityIndicator testID="delete-account-counts-loading" color={colors['text-1']} />
          </View>
        )}
        {countsState === 'error' && (
          <View style={{ gap: spacing.base }}>
            <Text style={[type.body, { color: colors.danger }]}>{countsError}</Text>
            <Button variant="secondary" label="Nochmal versuchen" onPress={openDeleteAccount} />
          </View>
        )}
        {countsState === 'ready' && counts && (
          <View style={{ gap: spacing.base }}>
            <Text style={[type.body, { color: colors['text-2'] }]}>{deletionSummaryText(counts)}</Text>
            {deleteError && <Text style={[type.body, { color: colors.danger }]}>{deleteError}</Text>}
            <DangerButton
              label="Konto endgültig löschen"
              onPress={() => void confirmDeleteAccount()}
              disabled={deleting}
            />
            <Button
              variant="secondary"
              label="Abbrechen"
              onPress={closeDeleteAccount}
              disabled={deleting}
            />
          </View>
        )}
      </Sheet>
    </View>
  );
}

// Since the image swap (2026-08-13) the passport stands small in the name
// card: the same 44 edge as the avatar circle that used to sit there, so the
// row keeps its shape. The large header image is the profile image now
// (AvatarPicker `large`, 160). The 1254 px source is far oversized for 44,
// but storing the same file twice would only add weight to the bundle.
const PASSPORT = 44;

const styles = StyleSheet.create({
  content: {
    padding: spacing.screen,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.l,
  },
  headerImage: { alignItems: 'center' },
  passport: { width: PASSPORT, height: PASSPORT },
  // `absoluteFill` spread as in AvatarCropper.surface (which also explains
  // why not absoluteFillObject). The surface itself comes inline from the
  // theme.
  nameEditor: { ...StyleSheet.absoluteFill },
  nameEditorContent: { padding: spacing.screen, gap: spacing.l },
  // Between hint and field the container spacing is enough, the zone only
  // needs the tight inner spacing between label and card.
  previewZone: { gap: spacing.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  rowText: { flex: 1, gap: spacing.xs },
  deleteAccountText: { textDecorationLine: 'underline', textAlign: 'center' },
  countsLoading: { alignItems: 'center', paddingVertical: spacing.l },
  dangerButton: {
    height: 52,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
});
