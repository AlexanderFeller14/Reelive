# Kamera: Videostabilisierung mit Sucher-Schalter

Stand: 2026-08-20, freigegeben.

## Problem

Reise-Videos entstehen in Bewegung (Zug, zu Fuss, Boot). Die MultiCam-Pipeline
nimmt unstabilisiert auf, obwohl AVFoundation Stabilisierung pro Connection
anbietet; Clips verwackeln. Zugleich braucht es einen Ausschalter: Stabilisierung
beschneidet das Bild (rund 10 % Crop) und kostet Hardware-Budget.

## Entscheid

- Modus fest `.standard`, nie `.auto` oder cinematic: die Cinematic-Modi puffern
  Frames (bis ~1 s Latenz) und würden die Instant-Pipeline zerstören
  (Foto = Frame-Grab aus dem Stream, Blitz-Vorlauf 150 ms, sofortiger
  Video-Start). `.standard` stabilisiert in Hardware mit minimaler Latenz.
- An per Default. Der Schalter im Sucher schaltet aus und wieder ein; nicht
  persistiert, wie der Blitz (jeder App-Start beginnt mit «an»).
- Alle drei Output-Connections werden gleich behandelt (wie der Blitz global
  über `flashWanted`), kein Sonderfall je aktiver Kamera.
- Preview-Connections bleiben unstabilisiert: spart Budget, und dieselbe
  Diskrepanz zwischen Sucher und Aufnahme hat Apples Kamera-App auch.
- Foto: der Frame-Grab erbt automatisch den stabilisierten, leicht gecroppten
  Frame; keine Sonderbehandlung. Der Schalter ist der Sache nach ein
  Video-Feature, echte Foto-Stabilisierung gibt es ohne `AVCapturePhotoOutput`
  nicht (bewusster Verzicht, siehe Kommentar bei `takePhoto`).

## Natives Modul (`mobile/modules/camera-zoom/ios/MultiCameraModule.swift`)

- Neuer statischer Zustand `stabilizationWanted` (Default `true`) nach dem
  Muster von `flashWanted`: Lock-geschützt, die synchrone
  `Function("stabilization")` merkt nur den Wunsch und stösst
  `applyStabilization()` an.
- `applyStabilization()` läuft auf der Session-Queue und setzt auf allen
  `outputConnections` `preferredVideoStabilizationMode` auf `.standard` bzw.
  `.off`; vorher wird geprüft, ob die Connection Stabilisierung unterstützt
  (`isVideoStabilizationSupported`) und das aktive Format den Modus kann
  (`activeFormat.isVideoStabilizationModeSupported(.standard)`). Kann ein
  Format den Modus nicht, bleibt diese Kamera still unstabilisiert; kein
  Format-Umbau in `chooseFormat`.
- `attach()` wendet den aktuellen Wunsch auf die frische Connection an, damit
  ein Session-Neuaufbau (Metro-Reload, Tab-Wechsel) den Zustand nicht verliert.

## Bridge (`mobile/src/features/camera/multiCamera.ts`)

- `setStabilization(on: boolean)` als dünner Wrapper, wie `setFlash`.

## UI (`mobile/src/app/(tabs)/capture/index.tsx`)

- `useState<'on' | 'off'>('on')` wie beim Blitz; dritter `PillButton` unter dem
  Blitz in der Controls-Spalte, nur im MultiCam-Zweig (der expo-camera-Fallback
  hat keine Stabilisierungs-API, dort bleibt die Spalte zweiknöpfig).
- Label «Stabilisierung ausschalten» / «Stabilisierung einschalten»; Icon
  Vorschlag `Vibrate`/`VibrateOff` (Lucide, outline, stroke 1.75), finale Wahl
  beim Umsetzen gegen DESIGN-LANGUAGE §4.
- Während einer laufenden Aufnahme blendet der Knopf aus wie «Kamera wechseln»
  und «Blitz» (Aufnahme-Sperren-Spec 2026-08-12): mitten im Video den Modus zu
  wechseln gäbe einen sichtbaren Sprung im Clip.
- Erweitert die Phase-4-Spec (2026-08-07, §4), die die Sucher-Pills wörtlich
  aufzählt: der Sucher trägt neu drei Pills.

## Tests

- Jest: Toggle-Zustand und `setStabilization`-Aufrufe im Screen-Test
  (`camera.test.tsx`), Bridge-Wrapper (`multiCamera.test.ts`), Fallback ohne
  Knopf, Ausblenden während der Aufnahme.
- Gerät (neuer Dev-Build nötig, natives Modul): sichtbare Glättung beim Gehen,
  Budget/System Pressure mit drei parallelen Streams, Foto-Latenz des
  Frame-Grabs unverändert, Blitz-Vorlauf 150 ms stimmt noch, Zoom- und
  Kamerawechsel unter Stabilisierung. Fällt der Budget-Test durch, wird der
  Default auf «aus» gedreht (einzeiliger Rückzug).

## Nicht in Scope

Cinematic-Modi, Stabilisierung der Preview, Persistenz des Schalters,
expo-camera-Fallback, Android.
