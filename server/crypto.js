// AES-256-GCM envelope encryption for user-supplied API keys (BYOK).
//
// Runs in both the Cloudflare Pages Function (Workers runtime) and the Vite dev
// middleware (Node ≥18) — both expose the Web Crypto API as the global
// `crypto`, so this file has zero dependencies and one code path.
//
// The master key lives ONLY in a server-side secret, `KEY_ENCRYPTION_SECRET`
// (base64 of 32 random bytes). It is never in the repo, never in client code,
// never sent to the browser. Encryption/decryption happen only on the server;
// the plaintext user key exists in memory transiently and is never logged,
// returned to the client, or stored in plaintext.
//
// Stored format (single string): `base64(iv).base64(ciphertext‖gcmTag)`.
// GCM appends its 16-byte auth tag to the ciphertext, so both are recoverable
// from the one field (spec §3.2 allows collapsing iv/tag into the ciphertext).

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function importMasterKey(secretB64) {
  if (!secretB64) throw new Error('KEY_ENCRYPTION_SECRET is not configured on the server.')
  const raw = b64ToBytes(secretB64.trim())
  if (raw.length !== 32) {
    throw new Error('KEY_ENCRYPTION_SECRET must be base64 of exactly 32 bytes (AES-256).')
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// plaintext → `base64(iv).base64(ct)`
export async function encryptSecret(plaintext, secretB64) {
  const key = await importMasterKey(secretB64)
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit nonce (GCM standard)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`
}

// `base64(iv).base64(ct)` → plaintext (throws if tampered — GCM auth tag)
export async function decryptSecret(packed, secretB64) {
  const key = await importMasterKey(secretB64)
  const [ivB64, ctB64] = String(packed).split('.')
  if (!ivB64 || !ctB64) throw new Error('Malformed ciphertext.')
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(ctB64)
  )
  return dec.decode(pt)
}

// Generate a fresh master key (base64 of 32 bytes) — for setup/rotation.
export function generateMasterKey() {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(32)))
}
