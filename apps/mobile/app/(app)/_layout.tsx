import React from 'react';
import { Tabs } from 'expo-router';
import { Platform, Text, StyleSheet } from 'react-native';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  // Simple text-based icons to avoid external icon dependency
  const icons: Record<string, string> = {
    collections: '\u2637', // trigram for heaven (list-like)
    profile: '\u263A', // white smiling face
  };
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>
      {icons[name] ?? '?'}
    </Text>
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1E40AF',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#F1F5F9',
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: '#1E40AF',
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
      }}
    >
      <Tabs.Screen
        name="collections"
        options={{
          title: 'Collections',
          headerTitle: 'Today\'s Collections',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="collections" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="record-payment"
        options={{
          href: null, // hide from tab bar — only navigated to directly
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerTitle: 'My Profile',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="profile" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 22,
    color: '#94A3B8',
  },
  iconFocused: {
    color: '#1E40AF',
  },
});
