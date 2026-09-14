import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text, useTheme } from 'react-native-paper';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

// ─── Types ────────────────────────────────────────────────────

export interface VenueCoords {
  latitude: number;
  longitude: number;
}

interface VenueMapPickerProps {
  /** Currently selected coordinates (or null if none yet) */
  coords: VenueCoords | null;
  /** Called when the user taps or drags the marker to a new position */
  onCoordsChange: (coords: VenueCoords) => void;
  /** Geofence radius in meters — displayed as a circle overlay */
  geofenceRadius: number;
}

// Default fallback region: Ormoc City, Leyte
const DEFAULT_COORDS: VenueCoords = {
  latitude: 11.0044,
  longitude: 124.6075,
};

// ─── Leaflet HTML Generator ───────────────────────────────────

function createLeafletHtml(initialLat: number, initialLng: number, radius: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }
    html, body, #map {
      height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #f0f4f8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .leaflet-control-attribution {
      font-size: 9px !important;
      background: rgba(255, 255, 255, 0.8) !important;
      padding: 2px 6px !important;
      border-radius: 4px !important;
    }
    .leaflet-bar {
      border: none !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15) !important;
      border-radius: 8px !important;
      overflow: hidden;
    }
    .leaflet-bar a {
      background-color: #ffffff !important;
      color: #333333 !important;
      border-bottom: 1px solid #eee !important;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var lat = ${initialLat};
    var lng = ${initialLng};
    var radius = ${radius};

    var map = L.map('map', {
      zoomControl: true,
      attributionControl: true
    }).setView([lat, lng], 16);

    // Free OpenStreetMap tiles (No API key or credit card needed)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    // Marker
    var marker = L.marker([lat, lng], {
      draggable: true
    }).addTo(map);

    // Geofence Circle Overlay
    var circle = L.circle([lat, lng], {
      color: '#0284c7',
      fillColor: '#38bdf8',
      fillOpacity: 0.25,
      weight: 2,
      radius: radius
    }).addTo(map);

    function notifyChange(newLat, newLng) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'COORDS_CHANGE',
          latitude: newLat,
          longitude: newLng
        }));
      }
    }

    // Tap anywhere to move venue marker and geofence
    map.on('click', function(e) {
      marker.setLatLng(e.latlng);
      circle.setLatLng(e.latlng);
      notifyChange(e.latlng.lat, e.latlng.lng);
    });

    // Drag marker
    marker.on('drag', function(e) {
      circle.setLatLng(marker.getLatLng());
    });

    marker.on('dragend', function() {
      var pos = marker.getLatLng();
      circle.setLatLng(pos);
      notifyChange(pos.lat, pos.lng);
    });

    // Injected APIs for smooth real-time updates
    window.updateRadius = function(newRadius) {
      if (circle) {
        circle.setRadius(newRadius);
      }
    };

    window.updatePosition = function(newLat, newLng) {
      if (marker && circle && map) {
        var newPos = [newLat, newLng];
        marker.setLatLng(newPos);
        circle.setLatLng(newPos);
        map.panTo(newPos, { animate: true, duration: 0.5 });
      }
    };
  </script>
</body>
</html>`;
}

// ─── Component ────────────────────────────────────────────────

export default function VenueMapPicker({
  coords,
  onCoordsChange,
  geofenceRadius,
}: VenueMapPickerProps) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const [initialCoords, setInitialCoords] = useState<VenueCoords | null>(coords);
  const [loadingLocation, setLoadingLocation] = useState(!coords);
  const [locatingUser, setLocatingUser] = useState(false);

  // Determine initial location on mount if not already provided
  useEffect(() => {
    let cancelled = false;

    if (coords) {
      setInitialCoords(coords);
      setLoadingLocation(false);
      return;
    }

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted' && !cancelled) {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) {
            const current: VenueCoords = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            };
            setInitialCoords(current);
            onCoordsChange(current);
            setLoadingLocation(false);
            return;
          }
        }
      } catch {
        // Fall back to default
      }

      if (!cancelled) {
        setInitialCoords(DEFAULT_COORDS);
        onCoordsChange(DEFAULT_COORDS);
        setLoadingLocation(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update geofence radius smoothly without reloading WebView
  useEffect(() => {
    if (webViewRef.current) {
      const script = `if (window.updateRadius) { window.updateRadius(${geofenceRadius}); } true;`;
      webViewRef.current.injectJavaScript(script);
    }
  }, [geofenceRadius]);

  // Handle messages from Leaflet map
  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'COORDS_CHANGE' && typeof data.latitude === 'number') {
        onCoordsChange({
          latitude: data.latitude,
          longitude: data.longitude,
        });
      }
    } catch {
      // Ignore unparseable messages
    }
  };

  // Re-center on current user location
  const handleCenterOnUser = async () => {
    setLocatingUser(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const newCoords: VenueCoords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        onCoordsChange(newCoords);
        webViewRef.current?.injectJavaScript(
          `if (window.updatePosition) { window.updatePosition(${newCoords.latitude}, ${newCoords.longitude}); } true;`
        );
      }
    } catch {
      // Ignore location error
    } finally {
      setLocatingUser(false);
    }
  };

  const htmlContent = useMemo(() => {
    const lat = initialCoords?.latitude ?? DEFAULT_COORDS.latitude;
    const lng = initialCoords?.longitude ?? DEFAULT_COORDS.longitude;
    return createLeafletHtml(lat, lng, geofenceRadius);
  }, [initialCoords, geofenceRadius]);

  if (loadingLocation || !initialCoords) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: theme.colors.elevation.level1 },
        ]}
      >
        <ActivityIndicator size="small" />
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
        >
          Locating venue area…
        </Text>
      </View>
    );
  }

  const activeCoords = coords ?? initialCoords;

  return (
    <View
      style={[
        styles.mapContainer,
        {
          borderColor: theme.colors.outlineVariant,
          backgroundColor: theme.colors.elevation.level1,
        },
      ]}
    >
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.map}
        onMessage={handleMessage}
        scrollEnabled={false}
        overScrollMode="never"
        javaScriptEnabled
        domStorageEnabled
      />

      {/* Recenter / GPS Button */}
      <View style={styles.topRightControls}>
        <IconButton
          icon={locatingUser ? 'loading' : 'crosshairs-gps'}
          mode="contained"
          size={20}
          containerColor={theme.colors.surface}
          iconColor={theme.colors.primary}
          onPress={handleCenterOnUser}
          disabled={locatingUser}
          style={styles.gpsButton}
        />
      </View>

      {/* Coordinates and Geofence radius badge */}
      <View
        style={[
          styles.coordsBadge,
          { backgroundColor: theme.colors.elevation.level3 },
        ]}
      >
        <Text
          variant="labelSmall"
          style={{ color: theme.colors.onSurfaceVariant, fontFamily: 'monospace' }}
        >
          {activeCoords.latitude.toFixed(5)}, {activeCoords.longitude.toFixed(5)} ({geofenceRadius}m)
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  mapContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: 12,
    position: 'relative',
    height: 240,
  },
  map: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    height: 240,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  topRightControls: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
  },
  gpsButton: {
    margin: 0,
    elevation: 3,
  },
  coordsBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    zIndex: 10,
  },
});
