import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1E40AF" />
      {message ? <Text style={styles.text}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  text: {
    marginTop: 16,
    fontSize: 15,
    color: '#64748B',
    fontWeight: '500',
  },
});
