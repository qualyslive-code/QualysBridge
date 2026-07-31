// QualysBridge — Utils

export const uid = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const genQID = () => {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () =>
      alpha[Math.floor(Math.random() * alpha.length)]
    ).join('')
  ).join('-');
};

export const fmtQID = (raw) => {
  const c = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16);
  return c.match(/.{1,4}/g)?.join('-') ?? c;
};

export const ago = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en', { month: 'short', day: 'numeric' });
};

export const fmtDur = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// Real diary-style date + time, not a relative "2m ago" tag — a self-note
// written today should still read clearly as "Jul 14 · 3:42 PM" a year
// from now, not lose meaning the moment it's no longer recent.
export const fmtDateTime = (ts) => {
  const d = new Date(ts);
  const datePart = d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
};
