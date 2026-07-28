// src/lib/e2e.js — end-to-end encryption helpers (libsodium crypto_box)
import sodium from 'react-native-libsodium';

// Encrypts plaintext for recipientPublicKey using senderPrivateKey.
// Returns a JSON string payload safe to store in message.body.
export async function encryptMessage(plaintext, recipientPublicKeyB64, senderPrivateKeyB64) {
  await sodium.ready;
  const recipientPk = sodium.from_base64(recipientPublicKeyB64);
  const senderSk = sodium.from_base64(senderPrivateKeyB64);
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const cipher = sodium.crypto_box_easy(sodium.from_string(plaintext), nonce, recipientPk, senderSk);
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
