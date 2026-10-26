import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { COLOR_TOKENS } from '@ht/shared';

type Theme = 'light' | 'dark';
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('ht-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* almacenamiento no disponible */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Variables CSS `--c-{token}-{bg|fg|border}` generadas desde COLOR_TOKENS (única fuente de color de los calendarios). */
function colorCss(): string {
  const block = (mode: 'light' | 'dark') =>
    Object.values(COLOR_TOKENS)
      .map((t) => `--c-${t.key}-bg:${t[mode].bg};--c-${t.key}-fg:${t[mode].fg};--c-${t.key}-border:${t[mode].border};`)
      .join('');
  return `:root{${block('light')}}.dark{${block('dark')}}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('ht-theme', theme);
    } catch {
      /* ignorar */
    }
  }, [theme]);
  const value = useMemo(() => ({ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }), [theme]);
  return (
    <ThemeCtx.Provider value={value}>
      <style>{colorCss()}</style>
      {children}
    </ThemeCtx.Provider>
  );
}
