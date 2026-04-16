import React, { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { queryClient } from '../src/lib/query-client';
import { useAuthStore } from '../src/stores/auth-store';
import LoadingScreen from '../src/components/LoadingScreen';

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading, restoreSession } = useAuthStore();

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Not authenticated — redirect to login
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Authenticated but still on login — redirect to app
      router.replace('/(app)/collections');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return <LoadingScreen message="Loading..." />;
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthGate />
    </QueryClientProvider>
  );
}
