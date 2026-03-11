/**
 * Platform detection utilities for Electron vs Capacitor/web builds.
 *
 * Note: @capacitor/core sets window.Capacitor even when bundled into the
 * Electron build, so we use Capacitor.isNativePlatform() to distinguish
 * a real native shell from the mere presence of the JS library.
 */

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.electronAPI;
};

export const isCapacitor = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    !!(window as any).Capacitor &&
    typeof (window as any).Capacitor.isNativePlatform === 'function' &&
    (window as any).Capacitor.isNativePlatform()
  );
};

export const isMobile = (): boolean => {
  return isCapacitor() && !isElectron();
};
