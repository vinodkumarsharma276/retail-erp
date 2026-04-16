import React from 'react';
import { Stack } from 'expo-router';

export default function CollectionsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1E40AF' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Today's Collections",
          headerShown: false, // Tab already shows header
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          title: 'Sale Details',
        }}
      />
    </Stack>
  );
}
