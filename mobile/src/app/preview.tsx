import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  LayoutAnimation,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Pencil, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MomentSubmissionAnimation } from '@/components/MomentSubmissionAnimation';
import { Pill } from '@/components/Pill';
import { PressScale } from '@/components/PressScale';
import { cinema, palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset } from '@/theme/useTopInset';
import * as media from '@/features/moments/media';
import * as placeAndTime from '@/features/moments/placeAndTime';
import * as handoff from '@/features/camera/handoff';
import * as nativeCapture from '@/features/camera/nativeCapture';
import * as uploadWorker from '@/features/moments/uploadWorker';
import { ownMomentCount } from '@/features/moments/counter';
import { useAuth } from '@/features/auth/AuthProvider';
import type { QueueJob } from '@/features/moments/types';

const { InstantPreview } = nativeCapture;

const CAPTION_MAX = 120;

// How long after a foreign pause of the video player the straggler checks
// whether the immediate resume took hold (see the effect on the player
// below). Short enough that the preview does not visibly stand still, long
// enough that the camera session rebuild underneath can have finished.
const RESUME_STRAGGLER_MS = 250;

const WITHOUT_TRIP_MESSAGE =
  'Diese Aufnahme lässt sich keiner Reise zuordnen. Geh zurück zur Kamera und versuch es nochmal.';
const WITHOUT_SESSION_MESSAGE = 'Du bist nicht angemeldet. Melde dich an und probier es nochmal.';
const SENDING_FAILED_MESSAGE =
  'Der Moment konnte nicht gesichert werden, oft weil kein Speicherplatz mehr frei ist. Räum etwas Platz frei und versuch es nochmal.';

function twoDigits(n: number): string {
  return String(n).padStart(2, '0');
}

// Local time on the device that took the capture, deliberately without Intl,
// to stay independent of the Jest/Hermes ICU support (same caution as
// tripDay.ts).
function timeDisplay(iso: string): string {
  const date = new Date(iso);
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

type Place = { lat: number | null; lng: number | null; place_name: string | null };
const NO_PLACE: Place = { lat: null, lng: null, place_name: null };

// Media screen (DESIGN-LANGUAGE v2 §1): fixed cinema palette, no useTheme(),
// same pattern as capture/index.tsx. `accent`/`on-accent`/`danger` come
// straight from `palette` because they are pure interaction and error colors
// that work independently of light or cinema.
function SubmitButton({
  onPress,
  loading,
}: {
  onPress: () => void;
  loading: boolean;
}) {
  return (
    <PressScale
      testID="submit-button"
      accessibilityRole="button"
      accessibilityState={{ disabled: loading }}
      disabled={loading}
      onPress={() => {
        if (!loading) onPress();
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.submitButton,
            { backgroundColor: pressed ? palette['accent-pressed'] : palette.accent },
          ]}
        >
          {loading ? (
            <ActivityIndicator testID="submit-loading" color={palette['on-accent']} />
          ) : (
            <Text style={[type.bodyMedium, { color: palette['on-accent'] }]}>Einsenden</Text>
          )}
        </View>
      )}
    </PressScale>
  );
}

export default function PreviewScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  // Edge to edge media screen without a header: the pill on top used to sit
  // under the island, the submit button at the bottom on the home indicator.
  // The three lower layers (footer, error, caption) stand at fixed distances
  // from each other and must therefore give way TOGETHER, otherwise they
  // overlap.
  const topInset = useTopInset(spacing.xl);
  // The footer sits deliberately closer to the edge than useBottomInset()
  // prescribes: on this screen it carries only ONE button, and that belongs
  // within thumb reach at the very bottom. `insets.bottom` means "directly
  // above the home indicator", not on it; devices without an indicator keep
  // the designed minimum margin.
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(spacing.base, insets.bottom);
  const {
    uri,
    type: mediaType,
    duration,
    tripId,
  } = useLocalSearchParams<{
    uri?: string;
    type: 'photo' | 'video';
    duration: string;
    tripId?: string;
  }>();

  const [caption, setCaption] = useState('');
  const [place, setPlace] = useState<Place>(NO_PLACE);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sealed, setSealed] = useState(false);
  const [counter, setCounter] = useState<number | null>(null);

  useEffect(() => {
    if (!tripId) return;
    let active = true;
    ownMomentCount(tripId)
      .then((count) => {
        if (active) setCounter(count);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tripId]);
  const [time] = useState(() => placeAndTime.now());

  const [photo] = useState(() => (mediaType === 'photo' ? handoff.takePhoto() : null));

  // The prewarmed player from the handoff (device finding 2026-08-14,
  // Snapchat as the benchmark): the camera creates and loads it BEFORE the
  // navigation, so the cut goes into an already running video. Without a
  // handoff (deep link, failed prewarming) the hook below loads from the uri
  // itself.
  const [prewarmed] = useState(() => (mediaType === 'video' ? handoff.takeVideo() : null));

  const prewarmedPlayer = prewarmed?.kind === 'player' ? prewarmed : null;

  const ownPlayer = useVideoPlayer(
    mediaType === 'video' && !prewarmed ? (uri ?? null) : null,
    (p) => {
      p.loop = true;
      p.muted = true;
      // mixWithOthers instead of the default 'auto': the preview is muted, it
      // does not need the audio session, and only this way does the
      // microphone rebuild of the camera screen underneath (see the effect
      // below) leave it playing on open instead of pausing it (device finding
      // 2026-08-14).
      p.audioMixingMode = 'mixWithOthers';
      p.play();
    }
  );
  const player = prewarmedPlayer?.player ?? ownPlayer;

  // The poster from the handoff (frame 0 of the video) stands until the
  // VideoView has really drawn its first frame: on the device it needs ~0.8 s
  // for that even when the player has long been running (measured 2026-08-14,
  // constant, JS thread free; the cost sits in the native view setup). The
  // switch from poster to video is invisible because the loop starts at frame
  // 0.
  const [posterVisible, setPosterVisible] = useState(true);

  // createVideoPlayer demands an explicit release, otherwise the native
  // player leaks. The hook player is cleaned up by the hook itself, the
  // poster file lies in the cache and goes with it.
  useEffect(() => {
    if (!prewarmedPlayer) return;
    const { player, poster } = prewarmedPlayer;
    return () => {
      player.release();
      if (poster) media.discardFile(poster);
    };
  }, [prewarmedPlayer]);

  // Device finding 2026-08-14: on leaving, the camera screen under this
  // preview releases its microphone (the mute switch on its CameraView) and
  // rebuilds its capture session while doing so; iOS pauses the muted player
  // up here along with it. Once, shortly after opening, without an error and
  // without a status change: the video then stood as a still. This preview
  // knows no intentional pause (deliberately without controls), so it answers
  // every pause with resuming immediately. The pause at the end of the loop
  // cannot be told apart from it and tolerates it: play() is a no-op there.
  // The straggler covers the case where the session rebuild swallows the
  // immediate play().
  useEffect(() => {
    if (mediaType !== 'video') return;
    let straggler: ReturnType<typeof setTimeout> | undefined;
    const subscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) return;
      player.play();
      if (straggler !== undefined) clearTimeout(straggler);
      straggler = setTimeout(() => {
        if (!player.playing) player.play();
      }, RESUME_STRAGGLER_MS);
    });
    return () => {
      subscription.remove();
      if (straggler !== undefined) clearTimeout(straggler);
    };
  }, [player, mediaType]);

  useEffect(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []);

  const sourceMissing = mediaType === 'photo' ? !photo && !uri : !uri;
  useEffect(() => {
    if (sourceMissing) router.replace('/capture');
  }, [sourceMissing, router]);

  // Height of the standing keyboard, 0 means closed.
  //
  // The screen gives way to it itself instead of relying on a
  // KeyboardAvoidingView: with `behavior="padding"` that one only sets a
  // `paddingBottom` on its own view, and that never reaches absolutely
  // positioned children. Here EVERY layer is absolutely positioned.
  //
  // What must NOT count into this is an own InputAccessoryView: it is
  // included in the reported keyboard height even when you cannot see it, and
  // the field sat about 100 points too high because of it. It is gone, the
  // "Fertig" now sits on the keyboard itself.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const [fieldOpen, setFieldOpen] = useState(false);

  useEffect(() => {
    // iOS announces the keyboard BEFORE it stands and delivers duration and
    // curve of its movement along with it. Android reports only afterwards.
    const isIOS = Platform.OS === 'ios';
    const rideAlong = (durationMs?: number, curve?: keyof typeof LayoutAnimation.Types) => {
      if (!durationMs) return;
      // The same means with which the KeyboardAvoidingView animates its
      // padding: the pill rides with the keyboard instead of jumping ahead of
      // it. `prefers-reduced-motion` stays deliberately unasked here because
      // this is the movement of the system itself, not our staging; iOS
      // already dampens it at the source.
      LayoutAnimation.configureNext({
        duration: durationMs,
        update: { duration: durationMs, type: LayoutAnimation.Types[curve ?? 'keyboard'] },
      });
    };
    const showListener = Keyboard.addListener(
      isIOS ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        rideAlong(e.duration, e.easing);
        // The largest reported height wins as long as the keyboard stands:
        // while typing, iOS swaps the bar above the keys (the "Write with
        // Siri" hint gives way to the word suggestions) and reports a new,
        // often smaller height while doing so.
        setKeyboardHeight((previous) => Math.max(previous, e.endCoordinates.height));
      }
    );
    const hideListener = Keyboard.addListener(
      isIOS ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => {
        rideAlong(e.duration, e.easing);
        setKeyboardHeight(0);
        setFieldOpen(false);
      }
    );
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void placeAndTime.determinePlace().then((result) => {
      if (active) setPlace(result);
    });
    return () => {
      active = false;
    };
  }, []);

  // Draggable caption: only `transform` moves (DESIGN-LANGUAGE §5), the
  // position accumulates via extractOffset() instead of jumping back to 0 on
  // every release.
  const [pan] = useState(() => new Animated.ValueXY());
  // Via useState instead of useRef, as with `pan` already: the swipe handlers
  // are read while rendering, and a ref must not be read while rendering
  // (react-hooks/refs). The responder is still created only once.
  const [panResponder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.extractOffset();
      },
    })
  );

  // Final-Review, Important 3: replace only swaps the focused entry for a NEW
  // one, so [camera, preview] became [camera, camera]. Every capture stacked
  // another camera screen, each with its own camera instance, and the back
  // gesture ran backwards through old cameras instead of out of the tab.
  // Closing this preview means taking it off the stack, which also fulfils
  // "no way back to the moment" (Spec §4). canGoBack(): the screen is also
  // reachable by deep link, and only THERE is replace right.
  //
  // The way back is an instant cut too (user decision 2026-08-18: a tried
  // 250 ms fade flew out again). What actually made the way back untidy was
  // the tab bar, which briefly fell back into its light shape under the
  // preview and visibly jumped on return; since the cinema bar hangs on the
  // SELECTED tab instead of on the focus, the layout stands from the first
  // frame (cinemaStage.ts / _layout.tsx).
  const backToCamera = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/capture');
  };

  const discard = () => {
    if (submitting) return;
    if (prewarmed?.kind === 'native') {
      nativeCapture.discard();
      backToCamera();
      return;
    }
    if (photo) {
      void photo.file.then((d) => media.discardFile(d.uri)).catch(() => {});
    } else if (uri) {
      media.discardFile(uri);
    }
    backToCamera();
  };

  const submit = async () => {
    if (submitting) return;

    if (!tripId) {
      setSubmitError(WITHOUT_TRIP_MESSAGE);
      return;
    }

    if (!userId) {
      setSubmitError(WITHOUT_SESSION_MESSAGE);
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    const postId = media.newMomentId();
    let prepared: { medium: string; thumb: string } | null = null;
    let source: string | null = null;
    try {
      if (prewarmed?.kind === 'native') await prewarmed.fileReady;
      source = photo ? (await photo.file).uri : (uri ?? null);
      if (!source) {
        throw new Error('Aufnahme ohne Quelle');
      }
      prepared =
        mediaType === 'video' ? await media.prepareVideo(source) : await media.preparePhoto(source);

      // Final-Review, Critical 2: camera, image processing and video still
      // all write into Library/Caches, a directory iOS may empty under
      // storage pressure, while the queue is supposed to hold moments for
      // days. Hence the durable copy here, before enqueuing.
      const { medium, thumb } = await media.persistDurably(postId, prepared);

      const extension = media.mediaExtension(mediaType, prepared.medium);

      const trimmedCaption = caption.trim();
      const job: QueueJob = {
        id: postId,
        post_id: postId,
        trip_id: tripId,
        author_id: userId,
        typ: mediaType,
        medium_uri: medium,
        thumb_uri: thumb,
        storage_key: media.storageKey(tripId, postId, extension),
        thumb_key: media.thumbKey(tripId, postId),
        caption: trimmedCaption.length > 0 ? trimmedCaption : null,
        captured_at: time.captured_at,
        captured_tz: time.captured_tz,
        lat: place.lat,
        lng: place.lng,
        place_name: place.place_name,
        duration_s: mediaType === 'video' ? Number(duration) : null,
        zustand: 'wartet',
        versuche: 0,
        naechster_versuch: Date.now(),
        zeile_angelegt: false,
        medium_geladen: false,
        thumb_geladen: false,
      };

      await uploadWorker.enqueueJob(job);

      media.discardFile(source);
      media.discardIntermediates(source, prepared);

      setSealed(true);
    } catch (error) {
      media.removeMomentFiles(postId);
      if (prepared && source) media.discardIntermediates(source, prepared);
      console.error('[preview] submit failed', error);
      setSubmitError(SENDING_FAILED_MESSAGE);
      setSubmitting(false);
    }
  };

  const placeTimeText = place.place_name
    ? `${place.place_name} · ${timeDisplay(time.captured_at)}`
    : timeDisplay(time.captured_at);

  const writing = keyboardHeight > 0;
  const writingPosition = (Platform.OS === 'ios' ? keyboardHeight : 0) + spacing.base;
  // `spacing.xl` is only the stand-in until the footer has measured itself
  // once.
  const restingPosition = bottomInset + (footerHeight || spacing.xl) + spacing.base;

  if (sourceMissing) return null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ animation: 'none' }} />

      {mediaType === 'video' ? (
        prewarmed?.kind === 'native' ? (
          // The own pipeline (Task 12): the native ring buffer is already
          // playing before this screen even draws, so this shape needs
          // neither a VideoView nor a poster.
          <InstantPreview testID="instant-preview" style={StyleSheet.absoluteFill} />
        ) : (
          <>
            <VideoView
              testID="video-preview"
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              nativeControls={false}
              allowsPictureInPicture={false}
              onFirstFrameRender={() => setPosterVisible(false)}
            />
            {posterVisible && prewarmedPlayer?.poster ? (
              <Image
                testID="video-poster"
                source={{ uri: prewarmedPlayer.poster }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : null}
          </>
        )
      ) : (
        <Image
          testID="photo-preview"
          source={photo ? photo.ref : { uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      )}

      {/* Photo scrims: the only gradient the app allows (DESIGN-LANGUAGE §1). */}
      <LinearGradient
        colors={['rgba(0,0,0,0.35)', 'transparent']}
        style={styles.scrimTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.35)']}
        style={styles.scrimBottom}
        pointerEvents="none"
      />

      {writing && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tastatur schliessen"
          style={StyleSheet.absoluteFill}
          onPress={() => Keyboard.dismiss()}
        />
      )}

      <Pill style={[styles.headerPill, { top: topInset }]}>
        <Text style={[type.secondary, { color: cinema['text-1'] }]}>{placeTimeText}</Text>
      </Pill>

      {/* Discarding sits as an X in the header, opposite place and time: it is
          the way back out of this screen, not an equal alternative to
          submitting. Below it used to stand next to the primary button and
          took a third of its width. */}
      <PressScale
        testID="discard-button"
        accessibilityRole="button"
        accessibilityLabel="Aufnahme verwerfen"
        disabled={submitting}
        onPress={discard}
        style={[styles.discardWrap, { top: topInset }]}
      >
        <Pill style={styles.discardPill}>
          <X size={18} color={cinema['text-1']} strokeWidth={1.75} />
        </Pill>
      </PressScale>

      {/* While writing the caption stands above the keyboard, at rest
          directly above the submit button: the two belong together, they
          should not stand there as two bands with emptiness in between. The
          swipe gesture rests while writing, otherwise every typo swipe would
          pull the field back under the keyboard; the offset is kept and
          returns on closing. */}
      <Animated.View
        testID="caption-field"
        {...(writing ? {} : panResponder.panHandlers)}
        style={[
          styles.captionWrap,
          writing
            ? { bottom: writingPosition }
            : { bottom: restingPosition, transform: pan.getTranslateTransform() },
        ]}
      >
        {fieldOpen ? (
          <Pill style={styles.captionPill}>
            <TextInput
              accessibilityLabel="Bildunterschrift"
              value={caption}
              onChangeText={(text) => setCaption(text.slice(0, CAPTION_MAX))}
              placeholder="Schreib etwas dazu"
              placeholderTextColor={cinema['text-2']}
              maxLength={CAPTION_MAX}
              autoFocus
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => Keyboard.dismiss()}
              // Android otherwise sets text in an input field to the top edge.
              textAlignVertical="center"
              style={[styles.captionInput, { color: cinema['text-1'] }]}
            />
          </Pill>
        ) : (
          <PressScale
            testID="caption-chip"
            accessibilityRole="button"
            accessibilityLabel={caption ? `Bildunterschrift ändern: ${caption}` : 'Etwas dazu schreiben'}
            onPress={() => setFieldOpen(true)}
            style={styles.chipWrap}
          >
            <Pill style={styles.chipPill}>
              {/* The pencil invites writing. Once something stands there the
                  text speaks for itself and the pencil would be noise. */}
              {!caption && <Pencil size={14} color={cinema['text-2']} strokeWidth={1.75} />}
              <Text
                style={[type.body, { color: caption ? cinema['text-1'] : cinema['text-2'] }]}
                numberOfLines={2}
              >
                {caption || 'Schreib etwas dazu'}
              </Text>
            </Pill>
          </PressScale>
        )}
      </Animated.View>

      <View
        testID="footer"
        style={[styles.footer, { bottom: bottomInset }]}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
      >
        {submitError && (
          <Text style={[type.secondary, styles.errorText, { color: palette.danger }]}>
            {submitError}
          </Text>
        )}
        <SubmitButton onPress={() => void submit()} loading={submitting} />
      </View>


      <MomentSubmissionAnimation
        visible={sealed}
        onFinished={backToCamera}
        counter={counter}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cinema['bg-0'] },
  scrimTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  scrimBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  headerPill: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.screen,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
    borderRadius: radius.pill,
  },
  // Position and swipe transform stay on the outer Animated.View (panResponder
  // needs a direct target for the gesture), the actual pill look (radius,
  // blur, tint, inner spacing) sits one layer deeper on `captionPill`
  // (components/Pill.tsx), otherwise the two could not be separated: `Pill` is
  // not an `Animated.View`.
  captionWrap: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: 168,
  },
  captionInput: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    fontVariant: type.body.fontVariant,
  },
  // The same shape as the chip it grows out of: on tap the pill should open,
  // not jump into a box. `minHeight` and `justifyContent` hold the text at
  // half height instead of letting it stick to the top.
  captionPill: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  // The chip takes only the width its text needs: `flex-start` on the holder,
  // which spans the full screen width. The pill itself is round (radius.pill)
  // like every other UI on a photo, DESIGN-LANGUAGE §4.
  chipWrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  chipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.s,
  },
  // The X lies opposite the place and time pill, at the same height.
  discardWrap: {
    position: 'absolute',
    right: spacing.screen,
  },
  discardPill: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { textAlign: 'center' },
  footer: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.xl,
    gap: spacing.m,
  },
  submitButton: {
    height: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
  },
});
