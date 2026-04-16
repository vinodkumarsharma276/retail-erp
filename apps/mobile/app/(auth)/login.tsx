import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShopsQuery, useLoginMutation } from '../../src/hooks/useAuth';

export default function LoginScreen() {
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showShopPicker, setShowShopPicker] = useState(false);

  const shopsQuery = useShopsQuery();
  const loginMutation = useLoginMutation();

  const selectedShop = shopsQuery.data?.find((s) => s.id === selectedShopId);

  function handleLogin() {
    if (!selectedShopId) return;
    if (!username.trim()) return;
    if (!password) return;

    loginMutation.mutate({
      username: username.trim(),
      password,
      shopId: selectedShopId,
    });
  }

  const errorMessage =
    loginMutation.error?.message ??
    (loginMutation.isError ? 'Login failed. Please try again.' : null);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo / App Name */}
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>R</Text>
            </View>
            <Text style={styles.appName}>RetailERP Collect</Text>
            <Text style={styles.tagline}>Employee Collection App</Text>
          </View>

          {/* Error message */}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Shop Selector */}
          <Text style={styles.label}>Select Shop</Text>
          <TouchableOpacity
            style={styles.selectBtn}
            onPress={() => setShowShopPicker(!showShopPicker)}
          >
            <Text
              style={[
                styles.selectBtnText,
                !selectedShop && styles.selectBtnPlaceholder,
              ]}
            >
              {selectedShop
                ? `${selectedShop.name} (${selectedShop.code})`
                : 'Choose your shop'}
            </Text>
            <Text style={styles.chevron}>{showShopPicker ? '\u25B2' : '\u25BC'}</Text>
          </TouchableOpacity>

          {showShopPicker && (
            <View style={styles.pickerList}>
              {shopsQuery.isLoading ? (
                <ActivityIndicator color="#1E40AF" style={styles.pickerLoading} />
              ) : shopsQuery.data?.length ? (
                shopsQuery.data.map((shop) => (
                  <TouchableOpacity
                    key={shop.id}
                    style={[
                      styles.pickerItem,
                      selectedShopId === shop.id && styles.pickerItemActive,
                    ]}
                    onPress={() => {
                      setSelectedShopId(shop.id);
                      setShowShopPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.pickerItemText,
                        selectedShopId === shop.id && styles.pickerItemTextActive,
                      ]}
                    >
                      {shop.name} ({shop.code})
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.pickerEmpty}>No shops available</Text>
              )}
            </View>
          )}

          {/* Employee ID */}
          <Text style={styles.label}>Employee ID</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="e.g. ve_emp1"
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Password */}
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor="#94A3B8"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            style={[
              styles.loginBtn,
              (!selectedShopId || !username.trim() || !password || loginMutation.isPending) &&
                styles.loginBtnDisabled,
            ]}
            onPress={handleLogin}
            disabled={
              !selectedShopId || !username.trim() || !password || loginMutation.isPending
            }
          >
            {loginMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.loginBtnText}>Log In</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.footerText}>
            Only employees with mobile access can log in.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E40AF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
  appName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
  },
  tagline: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  selectBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectBtnText: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '500',
  },
  selectBtnPlaceholder: {
    color: '#94A3B8',
  },
  chevron: {
    fontSize: 12,
    color: '#64748B',
  },
  pickerList: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    marginTop: 4,
    overflow: 'hidden',
  },
  pickerLoading: {
    paddingVertical: 20,
  },
  pickerItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  pickerItemActive: {
    backgroundColor: '#EFF6FF',
  },
  pickerItemText: {
    fontSize: 15,
    color: '#334155',
    fontWeight: '500',
  },
  pickerItemTextActive: {
    color: '#1E40AF',
    fontWeight: '700',
  },
  pickerEmpty: {
    paddingVertical: 20,
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#0F172A',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#0F172A',
  },
  eyeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  eyeText: {
    color: '#1E40AF',
    fontSize: 14,
    fontWeight: '600',
  },
  loginBtn: {
    backgroundColor: '#1E40AF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  loginBtnDisabled: {
    opacity: 0.5,
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  footerText: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 20,
    fontWeight: '500',
  },
});
