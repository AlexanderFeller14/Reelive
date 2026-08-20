import { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { AvatarSheetContent, AvatarPicker } from '@/components/AvatarPicker';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Sheet } from '@/components/Sheet';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import { useAuth } from '@/features/auth/AuthProvider';
import { AvatarCropper } from '@/components/AvatarCropper';
import { setzeAvatar } from '@/features/auth/avatarApi';
import type { Crop } from '@/features/auth/crop';
import { createProfile, validateDisplayName, validateUsername } from '@/features/auth/profileApi';

export default function ProfileSetupScreen() {
  const { colors } = useTheme();
  const topInset = useTopInset(spacing.xxl);
  const { userId, refreshProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [displayNameError, setDisplayNameError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageCrop, setImageCrop] = useState<Crop | null>(null);
  const [imageToCrop, setImageToCrop] = useState<
    { uri: string; width: number; height: number } | null
  >(null);
  const [imageSheetVisible, setImageSheetVisible] = useState(false);

  const submit = async () => {
    const uErr = validateUsername(username);
    const dErr = validateDisplayName(displayName);
    setUsernameError(uErr ?? undefined);
    setDisplayNameError(dErr ?? undefined);
    setFormError(null);
    if (uErr || dErr || !userId) return;
    setLoading(true);

    // Uploading only here, not already at selection time: before this point
    // there is no profile row, and an abandoned onboarding would leave behind
    // an object that belongs to nobody.
    let avatarKey: string | null = null;
    if (imageUri) {
      const result = await setzeAvatar(userId, imageUri, null, imageCrop ?? undefined);
      avatarKey = result.avatarKey;
    }
    // Careful: setzeAvatar() internally sets `profiles.avatar_key` via UPDATE,
    // which hits zero rows here because the row does not exist yet. That is
    // not an error (an UPDATE without a match reports none), and the returned
    // key is still correct because it is formed BEFORE the upload
    // (newAvatarKey). The value only reaches the row through createProfile.

    const { error, field } = await createProfile(userId, username, displayName, avatarKey);
    setLoading(false);
    if (error) {
      if (field === 'username') return setUsernameError(error);
      return setFormError(error);
    }
    await refreshProfile(); // the guard moves on to the tabs
  };

  return (
    // Two levels instead of one: the form carries the inner padding (and as
    // the sheet's parent it would be a 24 px indented band in the middle of
    // the screen), while this frame carries only surface and height and is
    // the parent that `StyleSheet.absoluteFill` in the sheet refers to. Same
    // split as in profile.tsx, there with a ScrollView instead of the form.
    <View style={[styles.frame, { backgroundColor: colors['bg-0'] }]}>
      <View testID="onboarding-form" style={[styles.form, { paddingTop: topInset }]}>
        <Text style={[type.h1, { color: colors['text-1'] }]}>Fast geschafft</Text>
        <Text style={[type.secondary, { color: colors['text-2'] }]}>
          So sehen dich deine Freunde im Recap.
        </Text>
        <View style={styles.imageRow}>
          <AvatarPicker
            name={displayName}
            avatarKey={null}
            localUri={imageUri}
            onOpen={() => setImageSheetVisible(true)}
          />
          <Text style={[type.secondary, { color: colors['text-2'] }]}>Profilbild (optional)</Text>
        </View>
        <Input
          label="Username"
          value={username}
          onChangeText={(t) => setUsername(t.toLowerCase())}
          error={usernameError}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="lea_2026"
        />
        <Input
          label="Anzeigename"
          value={displayName}
          onChangeText={setDisplayName}
          error={displayNameError}
          placeholder="Lea"
        />
        {formError && (
          <Text style={[type.body, { color: colors.danger }]}>{formError}</Text>
        )}
        <Button variant="primary" label="Los geht's" onPress={submit} loading={loading} />
      </View>

      <Sheet visible={imageSheetVisible} title="Profilbild" onClose={() => setImageSheetVisible(false)}>
        <AvatarSheetContent
          avatarKey={null}
          localUri={imageUri}
          onSelected={(uri, width, height) => setImageToCrop({ uri, width, height })}
          onRemove={() => {
            setImageUri(null);
            setImageCrop(null);
          }}
          onClose={() => setImageSheetVisible(false)}
        />
      </Sheet>

      {/* As in the profile tab: the crop is chosen inside the app, ever since
          `allowsEditing` made the image picker fail on large images. */}
      {imageToCrop && (
        <AvatarCropper
          uri={imageToCrop.uri}
          width={imageToCrop.width}
          height={imageToCrop.height}
          onCancel={() => setImageToCrop(null)}
          onDone={(rect) => {
            setImageUri(imageToCrop.uri);
            setImageCrop(rect);
            setImageToCrop(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // `frame` carries only surface and height: it is the sheet's reference
  // frame and must therefore have NO inner padding, otherwise the sheet
  // would sit 24 px away from the edge. Everything form-like (padding,
  // spacing) lives one level deeper in `form`; together they add up to
  // exactly the measurements that used to hang on a single `screen` style.
  frame: { flex: 1 },
  form: { flex: 1, padding: spacing.screen, paddingTop: spacing.xxl, gap: spacing.l },
  imageRow: { alignItems: 'center', gap: spacing.s },
});
