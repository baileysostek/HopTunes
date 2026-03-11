/**
 * Platform detection utilities for Electron vs Capacitor/web builds.
 */

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.electronAPI;
};

export const isCapacitor = (): boolean => {
  return typeof window !== 'undefined' && !!(window as any).Capacitor;
};

export const isMobile = (): boolean => {
  return isCapacitor();
};
