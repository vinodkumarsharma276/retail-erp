import * as SecureStore from 'expo-secure-store';

const KEYS = {
  ACCESS_TOKEN: 'retailerp_access_token',
  REFRESH_TOKEN: 'retailerp_refresh_token',
  SHOP_ID: 'retailerp_shop_id',
} as const;

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, token);
}

export async function deleteToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.REFRESH_TOKEN);
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, token);
}

export async function deleteRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN);
}

export async function getShopId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.SHOP_ID);
}

export async function setShopId(shopId: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.SHOP_ID, shopId);
}

export async function deleteShopId(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.SHOP_ID);
}

export async function clearAll(): Promise<void> {
  await Promise.all([deleteToken(), deleteRefreshToken(), deleteShopId()]);
}
