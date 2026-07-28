// QualysBridge — Theme
// Direct port of the C object from Qualy-v4.jsx

export const C = {
  bg:       '#07070F',
  s1:       '#0F0F1E',
  s2:       '#161628',
  s3:       '#1E1E34',
  border:   'rgba(94,79,232,0.12)',
  borderM:  'rgba(94,79,232,0.28)',
  text:     '#F0EBF8',
  sub:      'rgba(240,235,248,0.42)',
  dim:      'rgba(240,235,248,0.18)',
  accent:   '#5E4FE8',
  accentL:  '#7B6EF5',
  accentXL: '#9D93FF',
  accentD:  'rgba(94,79,232,0.13)',
  money:    '#00C896',
  moneyD:   'rgba(0,200,150,0.1)',
  warn:     '#F0A500',
  warnD:    'rgba(240,165,0,0.09)',
  danger:   '#E8505A',
  dangerD:  'rgba(232,80,90,0.1)',
  online:   '#00C896',
};

export const F = {
  // React Native uses fontFamily strings; web font fallbacks stripped
  syne:  'Syne_700Bold',    // loaded via expo-font
  syneX: 'Syne_800ExtraBold',
  inter: 'Inter_400Regular',
  inter5: 'Inter_500Medium',
  inter6: 'Inter_600SemiBold',
  inter7: 'Inter_700Bold',
  mono:  'JetBrainsMono_400Regular',
  mono5: 'JetBrainsMono_500Medium',
};

export const CURRENCIES = [
  { code: 'USD', sym: '$' },
  { code: 'KES', sym: 'KSh' },
  { code: 'NGN', sym: '₦' },
  { code: 'GBP', sym: '£' },
  { code: 'EUR', sym: '€' },
];

export const DESTRUCT = ['Off', '30s', '5m', '1h', '24h'];

export const REPORT_REASONS = [
  'Harassment or threats',
  'Spam or unsolicited messages',
  'Impersonation',
  'Inappropriate content',
  'Other',
];

export const PALETTE = [
  '#5E4FE8', '#00C896', '#E85080', '#F0A500',
  '#38BDF8', '#A855F7', '#EF4444', '#10B981',
];

export const WALL = 3;
