import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { MapPinMarker } from '@/components/MapPin';
import { useTheme } from '@/theme/ThemeProvider';
import { motion } from '@/theme/tokens';
import type {
  Viewport,
  Cluster,
  MapSurfaceHandle,
  MapSurfaceProps,
  MapPoint,
} from '@/features/map/types';

// The map surface, native version: react-native-maps on Apple Maps or
// Google Maps respectively. The twin for the browser lives in
// MapSurface.web.tsx and fulfills the same contract (features/map/types.ts)
// with Leaflet.
//
// What's in here stood, until Task 14, directly in the map screen
// (app/(tabs)/recap/[id]/karte.tsx). Pulled out is exactly the SURFACE:
// pins, line, camera and reporting the visible viewport. Everything else
// stays with the screen: what triggers a cluster, which day is filtered,
// which sheet is open. This surface knows nothing of trips, sheets and
// days; it shows what it's given, and reports what happens.
export const MapSurface = forwardRef<MapSurfaceHandle, MapSurfaceProps>(
  function MapSurface(
    {
      initialViewport,
      clusters,
      line,
      thumbFor,
      onCluster,
      opensSheet,
      onViewportChange,
      reducedMotion,
    },
    ref
  ) {
    const { colors } = useTheme();
    const mapRef = useRef<MapView>(null);

    // THE one place where the camera moves (Spec K12): both the cluster
    // zoom and the day filter call here. Two paths were guaranteed to
    // drift apart, and one of them would eventually be missing the
    // reduced-motion switch.
    //
    // The initial mount deliberately does NOT go through here: the map
    // opens with `initialRegion` directly at the target. There's nothing
    // to fly from.
    useImperativeHandle(
      ref,
      () => ({
        flyTo: (target: Viewport) => {
          // DESIGN-LANGUAGE §5: with reduced motion it jumps instead of
          // flying. `setRegion` is the jump, internally it calls
          // `animateToRegion` with duration 0 on the Fabric handle
          // (MapView.tsx:863-867).
          //
          // NOT `setNativeProps`, even though MapView has the method and
          // it type-checks: it forwards to `this.map`, and in 1.27.2 that
          // ref is attached to NO element (`ref={this.map}` doesn't occur
          // anywhere, only `ref={this.fabricMap}`). `this.map.current` is
          // therefore always null, the call a silent no-op. No crash that
          // would stand out, a camera that simply stays put, and only for
          // those who have reduced motion turned on.
          if (reducedMotion) mapRef.current?.setRegion(target);
          else mapRef.current?.animateToRegion(target, motion.duration.base);
        },
      }),
      [reducedMotion]
    );

    const clustersRef = useRef<Cluster[]>(clusters);
    useLayoutEffect(() => {
      clustersRef.current = clusters;
    }, [clusters]);

    const handlePress = useCallback(
      (anchor: MapPoint) => {
        const cluster = clustersRef.current.find((c) => c.anchor === anchor);
        // Unreachable as long as the pin comes from `clusters`, but a ref
        // that diverges from the tree would be exactly the bug the layout
        // effect above prevents. Better to do nothing than report the
        // wrong cluster.
        if (cluster) onCluster(cluster);
      },
      [onCluster]
    );

    return (
      <MapView
        ref={mapRef}
        testID="karte-flaeche"
        style={StyleSheet.absoluteFill}
        initialRegion={initialViewport}
        onRegionChangeComplete={onViewportChange}
      >
        {/* The line sits BEFORE the pins in the tree, so it lies beneath
            them. Under two points there's nothing to connect. */}
        {line.length > 1 && (
          <Polyline
            testID="karte-linie"
            coordinates={line}
            strokeColor={colors.accent}
            strokeWidth={3}
          />
        )}

        {/* The key hangs on the anchor, not on the cluster's contents:
            while zooming, the composition changes continuously, and a key
            derived from it would attach a new pin to the map every time,
            instead of redrawing the existing one. */}
        {clusters.map((g) => (
          <MapPinMarker
            key={g.anchor.moment.id}
            point={g.anchor}
            thumbUrl={thumbFor(g.anchor.moment.id)}
            count={g.points.length}
            // Same information the screen uses for the tap, so the label
            // for VoiceOver names what the tap REALLY does: zoom in or
            // open the sheet. It comes from the screen instead of being
            // calculated here, the reasoning lives on the prop (types.ts).
            opensSheet={opensSheet(g)}
            onPress={handlePress}
          />
        ))}
      </MapView>
    );
  }
);
