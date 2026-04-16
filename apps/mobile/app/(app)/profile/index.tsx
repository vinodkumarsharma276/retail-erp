import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useAuthStore } from '../../../src/stores/auth-store';
import { useLogoutMutation } from '../../../src/hooks/useAuth';

export default function ProfileScreen() {
  const { user, shop } = useAuthStore();
  const logoutMutation = useLogoutMutation();

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  function handleLogout() {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => logoutMutation.mutate(),
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.container}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.fullName ?? 'E')[0].toUpperCase()}
            </Text>
          </View>
          <Text style={styles.fullName}>{user?.fullName ?? 'Employee'}</Text>
          <Text style={styles.username}>@{user?.username ?? ''}</Text>
        </View>

        {/* Info Cards */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Employee ID</Text>
            <Text style={styles.infoValue}>{user?.username ?? '-'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Role</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>
                {(user?.role ?? 'employee').toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Assigned Shop</Text>
            <Text style={styles.infoValue}>
              {shop ? `${shop.name} (${shop.code})` : '-'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Mobile Only</Text>
            <Text style={styles.infoValue}>
              {user?.isMobileOnly ? 'Yes' : 'No'}
            </Text>
          </View>
        </View>

        {/* App Info */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App</Text>
            <Text style={styles.infoValue}>RetailERP Collect</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>{appVersion}</Text>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          disabled={logoutMutation.isPending}
        >
          <Text style={styles.logoutBtnText}>
            {logoutMutation.isPending ? 'Logging out...' : 'Log Out'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    flex: 1,
    padding: 16,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E40AF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  fullName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  username: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  infoLabel: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  roleBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E40AF',
    letterSpacing: 0.5,
  },
  logoutBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  logoutBtnText: {
    color: '#DC2626',
    fontSize: 16,
    fontWeight: '700',
  },
});
