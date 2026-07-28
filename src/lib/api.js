// src/lib/api.js
// Client for QualysBridge-Backend (PayPal transfers, media, call signaling).
import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error('Missing EXPO_PUBLIC_API_URL. Check eas.json / .env.');
}

async function authedFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, kind: 'unauthenticated' };
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, kind: json.error || 'request_failed', message: json.message };
  }
  return { ok: true, data: json };
}

export function createPaypalOrder({ conversationId, receiverId, amount, currencyCode, note }) {
  return authedFetch('/payments/paypal/create-order', {
    method: 'POST',
    body: JSON.stringify({ conversationId, receiverId, amount, currencyCode, note }),
  });
}

export function capturePaypalOrder({ orderId }) {
  return authedFetch('/payments/paypal/capture-order', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
}

export const API_BASE = API_URL;

export function getMediaUploadUrl({ conversationId, fileExt }) {
  return authedFetch('/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({ conversationId, fileExt }),
  });
}

export function getMediaDownloadUrl({ path }) {
  return authedFetch('/media/download-url', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}
