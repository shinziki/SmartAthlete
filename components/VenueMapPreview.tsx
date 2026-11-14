import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, useTheme } from 'react-native-paper';
import { WebView } from 'react-native-webview';

/**
 * Read-only map of the session venue the coach pinned (same Leaflet + OpenStreetMap
 * map as the coach's VenueMapPicker): the venue pin, the check-in geofence circle and,
 * when known, the athlete's own position.
 */

interface VenueMapPreviewProps {
  latitude: number;
  longitude: number;
  /** Geofence radius in meters */
  radius: number;
  venueName: string;
  /** Athlete's current position (updates the blue dot live) */
  athletePosition?: { latitude: number; longitude: number } | null;
  /** Athlete is inside the geofence (colors the circle) */
  inside?: boolean;
  height?: number;
}

function createPreviewHtml(lat: number, lng: number, radius: number, venue: string): string {
  const safeVenue = JSON.stringify(venue);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: #e8eef3; }
    .leaflet-control-attribution { font-size: 8px !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    // A picture of the venue: no panning or zooming
    var venue = [${lat}, ${lng}];
    var map = L.map('map', {
      zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false
    // The circle's bounds can only be computed once the map has a view
    }).setView(venue, 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);

    var circle = L.circle(venue, {
      radius: ${radius}, color: '#0284c7', fillColor: '#38bdf8', fillOpacity: 0.22, weight: 2
    }).addTo(map);
    // Venue name is in the card footer; a label here would cover the athlete's dot
    L.marker(venue, { title: ${safeVenue} }).addTo(map);

    var me = null;
    function fit() {
      var bounds = circle.getBounds();
      if (me) bounds.extend(me.getLatLng());
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
    }
    // Called from the app as the athlete's GPS position changes
    window.setAthlete = function (lat, lng, inside) {
      if (!me) {
        me = L.circleMarker([lat, lng], {
          radius: 7, color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1
        }).addTo(map);
      } else {
        me.setLatLng([lat, lng]);
      }
      circle.setStyle(inside
        ? { color: '#16a34a', fillColor: '#4ade80' }
        : { color: '#0284c7', fillColor: '#38bdf8' });
      fit();
    };
    fit();
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready');
  </script>
</body>
</html>`;
}

export default function VenueMapPreview({
  latitude,
  longitude,
  radius,
  venueName,
  athletePosition,
  inside = false,
  height = 210,
}: VenueMapPreviewProps) {
  const theme = useTheme();
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Rebuild the page only when the venue itself changes, not on every GPS update
  const html = useMemo(
    () => createPreviewHtml(latitude, longitude, radius, venueName),
    [latitude, longitude, radius, venueName]
  );

  useEffect(() => {
    if (!ready || !athletePosition) return;
    webRef.current?.injectJavaScript(
      `window.setAthlete && window.setAthlete(${athletePosition.latitude}, ${athletePosition.longitude}, ${inside}); true;`
    );
  }, [ready, athletePosition?.latitude, athletePosition?.longitude, inside]);

  const openInMaps = () => {
    const label = encodeURIComponent(venueName);
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?ll=${latitude},${longitude}&q=${label}`
        : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`)
    );
  };

  return (
    <View style={[styles.wrapper, { borderColor: theme.colors.outlineVariant }]}>
      <View style={{ height }} pointerEvents="none">
        {failed ? (
          <View style={[styles.center, { backgroundColor: theme.colors.elevation.level2 }]}>
            <Icon source="map-marker-off-outline" size={28} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
              Map needs an internet connection
            </Text>
          </View>
        ) : (
          <WebView
            ref={webRef}
            source={{ html }}
            originWhitelist={['*']}
            javaScriptEnabled
            scrollEnabled={false}
            onMessage={(e) => e.nativeEvent.data === 'ready' && setReady(true)}
            onError={() => setFailed(true)}
            style={{ backgroundColor: 'transparent' }}
          />
        )}
        {!ready && !failed && (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <ActivityIndicator />
          </View>
        )}
      </View>

      <View style={[styles.footer, { backgroundColor: theme.colors.surface }]}>
        <View style={{ flex: 1 }}>
          <Text variant="labelMedium" style={{ fontWeight: '700', color: theme.colors.onSurface }} numberOfLines={1}>
            📍 {venueName}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Check-in area: {radius}m radius{athletePosition ? ' · blue dot is you' : ''}
          </Text>
        </View>
        <Button mode="text" compact icon="directions" onPress={openInMaps} labelStyle={{ fontSize: 12 }}>
          Open in Maps
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 6,
  },
});
