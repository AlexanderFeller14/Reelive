import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export type PushRegistrationResult = 'ok' | 'no_permission' | 'unsupported' | 'fehler';

// ----------------------------------------------------------------------------
// Every failure here is a NORMAL CASE, not an error (Task-4-brief): no
// permission, simulator, web, Expo Go. The app has so far been developed
// exclusively in Expo Go, and per the Expo docs, Expo Go can receive NO
// remote pushes at all since SDK 53 ("You must use a development build to
// use push notifications since the capability is not built into Expo
// Go"). This path is therefore the EVERYDAY case, not the exception. The
// function must therefore NEVER throw and NEVER show the person anything,
// it only returns the matching value. The try/catch around the whole flow
// is therefore not a safety net for edge cases, but carries the normal
// case.
//
// Concretely observed behavior of expo-notifications in Expo Go (source:
// node_modules/expo-notifications/build/warnOfExpoGoPushUsage.js):
// - The mere import of `expo-notifications` does NOT warn/throw. The
//   native module for permissions is still built into Expo Go; only
//   access to the PUSH TOKEN is affected (see below). getPermissionsAsync
//   and requestPermissionsAsync run through normally in Expo Go.
// - Only on the token fetch (Notifications.getExpoPushTokenAsync, calls
//   getDevicePushTokenAsync internally) does the Expo Go lock kick in: on
//   ANDROID it throws a synchronous Error, on iOS only a console.warn,
//   where the fetch then fails anyway on the missing EAS project (no
//   eas.json in this repo → ERR_NOTIFICATIONS_NO_EXPERIENCE_ID) or on the
//   missing native push setup of Expo Go. Both ends land in the catch
//   below and become 'fehler', never a throw to the outside.
// ----------------------------------------------------------------------------
export async function registerPushToken(userId: string): Promise<PushRegistrationResult> {
  try {
    // push_tokens.platform only allows 'ios'|'android' via a CHECK
    // constraint (migration 20260808090000_push_tokens.sql). Web or
    // future platforms are "not supported", not an error.
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';

    // A simulator/emulator never gets a real push token, expo-device
    // exists for that (brief step 2).
    if (!Device.isDevice) return 'unsupported';

    // Android 13+ (per version-exact SDK-57 docs, see AGENTS.md): the
    // system permission dialog only appears AFTER at least one
    // notification channel exists, without this call requestPermissionsAsync()
    // below would be ineffective (no dialog, status stays 'undetermined'),
    // which cleanly leads into 'no_permission' anyway. On iOS/web
    // this call is a documented no-op (console.debug + null), on Android
    // best-effort: if it fails (e.g. Expo Go), that doesn't break the rest
    // of the flow, it simply runs the same 'no_permission'/'fehler'
    // path as without a channel.
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Reelive',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      } catch {
        // Best effort, see comment above.
      }
    }

    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') {
      // Only ask if not yet decided or declined, the native request
      // itself shows the person the system dialog, which is correct here
      // (no own dialog before it, DESIGN-LANGUAGE doesn't call for one).
      permission = await Notifications.requestPermissionsAsync();
    }
    if (permission.status !== 'granted') return 'no_permission';

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token) return 'fehler';

    const { error } = await supabase.from('push_tokens').upsert(
      {
        token,
        user_id: userId,
        platform: Platform.OS,
        // Sent explicitly: PostgREST builds an "on conflict do update
        // set" from .upsert() only over the SENT columns. Without this
        // field, updated_at would stay at the value of the first insert,
        // even though the same device registers again for years
        // afterward, whoever later cleans up by updated_at would then
        // clean up wrongly (review from Task 1).
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    );
    if (error) return 'fehler';

    return 'ok';
  } catch {
    return 'fehler';
  }
}

// ----------------------------------------------------------------------------
// Called from authApi.signOut() (see there), NOT via push registration
// itself, not part of the Task-4 interface contract, but needed from the
// Task 1 review: without this, the previous person's registration stays
// on the device, and the takeover path of the Task 1 SECURITY-DEFINER
// trigger (push_tokens_take_over) becomes the normal case instead of the
// exception.
//
// Deliberately determines the same token again instead of caching a
// previously registered token locally, this app has no such storage yet,
// and a second storage location for the same value would be another
// source that can go stale. Permission is checked FIRST (pure read, no
// dialog, no native registration): without 'granted', registerPushToken()
// never wrote a row, so there's nothing to delete, and
// getExpoPushTokenAsync() isn't even called, which would otherwise
// trigger a real native push registration on every sign-out, even for
// people who were never asked. If permission is granted,
// getExpoPushTokenAsync() returns the same token without another dialog;
// if the fetch still fails (Expo Go, no EAS project, everyday case, see
// above), there's likewise nothing to delete. Therefore deletes ONLY its
// own row via the RLS policy push_tokens_delete_own (user_id = auth.uid());
// other devices of the same person stay registered.
export async function deregisterPushToken(): Promise<void> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token) return;
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // Nothing to delete or no access possible, on sign-out this must
    // never hold up the process or show the person anything.
  }
}
