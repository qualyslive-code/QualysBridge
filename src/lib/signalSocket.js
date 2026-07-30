// src/lib/signalSocket.js
//
// Single shared WebSocket to /calls/signal, owned here — not by any
// individual context. CallContext (1:1) and GroupCallContext (rooms)
// both subscribe to messages and both send through this module, so
// only one socket is ever open per user session. Previously CallContext
// owned the socket directly; a second owner (GroupCallContext) would
// have caused the backend to close the first connection (it replaces
// any existing socket per user id), silently breaking 1:1 calls.
//
// Lifecycle (connect/disconnect) is driven by CallContext, since it's
// the context mounted at app root with a real myUser. GroupCallContext
// only subscribes/sends — it never calls connect() or disconnect().

import { supabase } from './supabase';
import { API_BASE } from './api';

let ws = null;
let cancelled = true;
let retryTimer = null;
const listeners = new Set(); // Set<(msg) => void>

function notify(msg) {
  listeners.forEach((fn) => {
    try { fn(msg); } catch {}
  });
}

export function subscribe(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function send(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

export function isConnected() {
  return ws?.readyState === 1;
}

export function connect() {
  cancelled = false;

  const open = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || cancelled) return;
    const base = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');
    const socket = new WebSocket(`${base}/calls/signal?token=${session.access_token}`);
    ws = socket;
    socket.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      notify(msg);
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      if (!cancelled) retryTimer = setTimeout(open, 3000);
    };
    socket.onerror = () => socket.close();
  };
  open();
}

export function disconnect() {
  cancelled = true;
  if (retryTimer) clearTimeout(retryTimer);
  ws?.close();
  ws = null;
}
