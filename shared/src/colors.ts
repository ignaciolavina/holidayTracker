/**
 * Tokens de color (SPEC-19). Única fuente de verdad para todas las vistas y la leyenda.
 * Cada token tiene versión clara y oscura. El color nunca es la única señal: cada elemento lleva icono/patrón/tooltip.
 */

export interface ColorToken {
  key: string;
  label: string;
  light: { bg: string; fg: string; border: string };
  dark: { bg: string; fg: string; border: string };
  /** señal no cromática que acompaña al color */
  marker: 'solid' | 'striped' | 'diagonal' | 'icon' | 'dimmed' | 'ring' | 'text';
  icon?: string;
}

export const COLOR_TOKENS = {
  approved: {
    key: 'approved',
    label: 'Vacaciones aprobadas',
    light: { bg: '#5A1294', fg: '#ffffff', border: '#430d6f' },
    dark: { bg: '#a46ad6', fg: '#1a0530', border: '#c49be6' },
    marker: 'solid',
    icon: '✓',
  },
  carryover: {
    key: 'carryover',
    label: 'Vacaciones de días arrastrados',
    light: { bg: '#0d9488', fg: '#ffffff', border: '#0f766e' },
    dark: { bg: '#14b8a6', fg: '#04201d', border: '#2dd4bf' },
    marker: 'solid',
    icon: '↻',
  },
  pending: {
    key: 'pending',
    label: 'Pendiente de aprobar',
    light: { bg: '#f1e8fa', fg: '#3b0b63', border: '#5A1294' },
    dark: { bg: '#2a1540', fg: '#e3cdf7', border: '#a46ad6' },
    marker: 'striped',
    icon: '⏳',
  },
  birthday: {
    key: 'birthday',
    label: 'Día de cumpleaños',
    light: { bg: '#db2777', fg: '#ffffff', border: '#be185d' },
    dark: { bg: '#ec4899', fg: '#2a0716', border: '#f472b6' },
    marker: 'icon',
    icon: '🎂',
  },
  halfDay: {
    key: 'halfDay',
    label: 'Medio día',
    light: { bg: '#5A1294', fg: '#ffffff', border: '#430d6f' },
    dark: { bg: '#a46ad6', fg: '#1a0530', border: '#c49be6' },
    marker: 'diagonal',
    icon: '◐',
  },
  holidayNational: {
    key: 'holidayNational',
    label: 'Festivo nacional',
    light: { bg: '#fecaca', fg: '#7f1d1d', border: '#ef4444' },
    dark: { bg: '#7f1d1d', fg: '#fee2e2', border: '#f87171' },
    marker: 'icon',
    icon: 'N',
  },
  holidayRegional: {
    key: 'holidayRegional',
    label: 'Festivo autonómico (Comunidad de Madrid)',
    light: { bg: '#fed7aa', fg: '#7c2d12', border: '#f97316' },
    dark: { bg: '#7c2d12', fg: '#ffedd5', border: '#fb923c' },
    marker: 'icon',
    icon: 'A',
  },
  holidayLocal: {
    key: 'holidayLocal',
    label: 'Festivo local (Madrid)',
    light: { bg: '#fde68a', fg: '#713f12', border: '#eab308' },
    dark: { bg: '#713f12', fg: '#fef9c3', border: '#facc15' },
    marker: 'icon',
    icon: 'L',
  },
  weekend: {
    key: 'weekend',
    label: 'Fin de semana',
    light: { bg: '#f5f2f8', fg: '#a59cb0', border: '#e9e3ef' },
    dark: { bg: '#130b1c', fg: '#5e5269', border: '#24182f' },
    marker: 'dimmed',
  },
  today: {
    key: 'today',
    label: 'Hoy',
    light: { bg: 'transparent', fg: '#1a0530', border: '#f59e0b' },
    dark: { bg: 'transparent', fg: '#f8fafc', border: '#fbbf24' },
    marker: 'ring',
  },
  negative: {
    key: 'negative',
    label: 'Saldo negativo',
    light: { bg: '#fee2e2', fg: '#b91c1c', border: '#dc2626' },
    dark: { bg: '#450a0a', fg: '#fca5a5', border: '#f87171' },
    marker: 'text',
    icon: '−',
  },
} as const satisfies Record<string, ColorToken>;

export type ColorKey = keyof typeof COLOR_TOKENS;

export const LEGEND_ORDER: ColorKey[] = [
  'approved',
  'carryover',
  'pending',
  'birthday',
  'halfDay',
  'holidayNational',
  'holidayRegional',
  'holidayLocal',
  'weekend',
  'today',
  'negative',
];
