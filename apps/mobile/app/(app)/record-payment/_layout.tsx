import React from 'react';
import { Stack } from 'expo-router';

export default function RecordPaymentLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1E40AF' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
      }}
    >
      <Stack.Screen
        name="[installmentId]"
        options={{
          title: 'Record Payment',
        }}
      />
    </Stack>
  );
}
