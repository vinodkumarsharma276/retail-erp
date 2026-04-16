import { create } from 'zustand';

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
