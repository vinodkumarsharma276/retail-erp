import { create } from 'zustand';

/**
 * Sentinel value the frontend stores in `currentShopId` when the user
 * has chosen "All Shops" in the header dropdown. The api-client request
 * interceptor forwards this verbatim as the `X-Shop-Id` header; the
 * backend `shopScope` middleware recognises it and (if the user has the
 * `shops.view_all` permission) fans the request out across every
 * accessible shop.
 *
 * Real shop IDs are UUIDs so collision with `'all'` is impossible.
 */
export const ALL_SHOPS_SENTINEL = 'all';

export function isAllShops(shopId: string | null | undefined): boolean {
  return shopId === ALL_SHOPS_SENTINEL;
}

interface ShopState {
  currentShopId: string | null;
  currentShopName: string | null;
  currentShopCode: string | null;
  setShop: (id: string, name: string, code: string) => void;
  clearShop: () => void;
}

export const useShopStore = create<ShopState>((set) => ({
  currentShopId: localStorage.getItem('currentShopId'),
  currentShopName: localStorage.getItem('currentShopName'),
  currentShopCode: localStorage.getItem('currentShopCode'),
  setShop: (id, name, code) => {
    localStorage.setItem('currentShopId', id);
    localStorage.setItem('currentShopName', name);
    localStorage.setItem('currentShopCode', code);
    set({ currentShopId: id, currentShopName: name, currentShopCode: code });
  },
  clearShop: () => {
    localStorage.removeItem('currentShopId');
    localStorage.removeItem('currentShopName');
    localStorage.removeItem('currentShopCode');
    set({ currentShopId: null, currentShopName: null, currentShopCode: null });
  },
}));
