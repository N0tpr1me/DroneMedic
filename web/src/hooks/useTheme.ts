import { useEffect } from 'react';

/**
 * Applies the `light` class to `<html>` when dark mode is off.
 * Dark is the default — no class needed.
 */
export function useTheme(darkMode: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.remove('light');
    } else {
      root.classList.add('light');
    }
    return () => {
      root.classList.remove('light');
    };
  }, [darkMode]);
}
