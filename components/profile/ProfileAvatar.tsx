import { pickAndUploadProfilePhoto, removeProfilePhoto } from '@/lib/profilePhoto';
import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Avatar, IconButton, TouchableRipple, useTheme } from 'react-native-paper';

/**
 * Avatar that shows the user's photo (or initials) and lets them change/remove it.
 */
export default function ProfileAvatar({
  userId,
  initials,
  photoUrl,
  onChange,
  size = 72,
}: {
  userId: string | null;
  initials: string;
  photoUrl: string | null;
  onChange: (url: string | null) => void;
  size?: number;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const url = await pickAndUploadProfilePhoto(userId);
      if (url) onChange(url);
    } catch (err: any) {
      Alert.alert('Could not update photo', err?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await removeProfilePhoto(userId);
      onChange(null);
    } catch (err: any) {
      Alert.alert('Could not remove photo', err?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const openMenu = () => {
    if (busy) return;
    if (!photoUrl) return void choose();
    Alert.alert('Profile photo', undefined, [
      { text: 'Choose new photo', onPress: choose },
      { text: 'Remove photo', style: 'destructive', onPress: remove },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <TouchableRipple
      onPress={openMenu}
      borderless
      style={{ borderRadius: size / 2 }}
      accessibilityLabel="Change profile photo"
    >
      <View style={{ width: size, height: size }}>
        {photoUrl ? (
          <Avatar.Image size={size} source={{ uri: photoUrl }} />
        ) : (
          <Avatar.Text
            size={size}
            label={initials}
            style={{ backgroundColor: theme.colors.primary }}
            color={theme.colors.onPrimary}
            labelStyle={{ fontWeight: '700', fontSize: size / 3 }}
          />
        )}
        {busy ? (
          <View style={[styles.overlay, { borderRadius: size / 2 }]}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <IconButton
            icon="camera"
            size={14}
            mode="contained"
            containerColor={theme.colors.surface}
            iconColor={theme.colors.primary}
            style={styles.badge}
            onPress={openMenu}
          />
        )}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', right: -8, bottom: -8, margin: 0, width: 28, height: 28 },
});

