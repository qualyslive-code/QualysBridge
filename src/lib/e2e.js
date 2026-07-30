// src/lib/e2e.js — end-to-end encryption helpers (libsodium crypto_box)
import sodium from 'react-native-libsodium';
import { supabase } from './supabase';

// Encrypts plaintext for recipientPublicKey using senderPrivateKey.
// Returns a JSON string payload safe to store in message.body.
export async function encryptMessage(plaintext, recipientPublicKeyB64, senderPrivateKeyB64) {
  await sodium.ready;
  const recipientPk = sodium.from_base64(recipientPublicKeyB64);
  const senderSk = sodium.from_base64(senderPrivateKeyB64);
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const cipher = sodium.crypto_box_easy(plaintext, nonce, recipientPk, senderSk);
  return JSON.stringify({ n: sodium.to_base64(nonce), c: sodium.to_base64(cipher) });
}

// Decrypts a payload produced by encryptMessage. Returns null on any
// failure (wrong keys, corrupt payload) instead of throwing.
export async function decryptMessage(payloadJson, senderPublicKeyB64, recipientPrivateKeyB64) {
  try {
    await sodium.ready;
    const { n, c } = JSON.parse(payloadJson);
    if (!n || !c) return null;
    const senderPk = sodium.from_base64(senderPublicKeyB64);
    const recipientSk = sodium.from_base64(recipientPrivateKeyB64);
    const plain = sodium.crypto_box_open_easy(
      sodium.from_base64(c), sodium.from_base64(n), senderPk, recipientSk
    );
    return sodium.to_string(plain);
  } catch {
    return null;
  }
}

// True if body is an {n,c} encrypted payload rather than legacy plaintext.
export function isEncryptedPayload(body) {
  if (typeof body !== 'string') return false;
  try {
    const p = JSON.parse(body);
    return !!(p && p.n && p.c);
  } catch {
    return false;
  }
}

import * as SecureStore from 'expo-secure-store';

export async function ensureKeyPair(userId) {
  await sodium.ready;
  const existing = await SecureStore.getItemAsync(`e2e_privkey_${userId}`);
  if (existing) return;

  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  const pubB64 = sodium.to_base64(publicKey);
  const privB64 = sodium.to_base64(privateKey);

  await SecureStore.setItemAsync(`e2e_privkey_${userId}`, privB64);

  const { error } = await supabase
    .from('app_user')
    .update({ public_key: pubB64 })
    .eq('id', userId);
  if (error) throw error;
}
