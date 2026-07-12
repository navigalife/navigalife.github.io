/**
 * Passcode vault: the fine-grained PAT is stored only AES-GCM-encrypted under
 * a key derived from the device passcode (PBKDF2-SHA-256, 600k iterations).
 * The plain token exists in sessionStorage for the tab session after unlock.
 */
const VAULT_KEY = 'medivasc-admin-vault';
const ITERATIONS = 600000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const fromBase64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const deriveKey = async (passcode, salt) => {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

export const vaultExists = () => Boolean(localStorage.getItem(VAULT_KEY));

export const createVault = async (token, passcode, branch) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passcode, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
  localStorage.setItem(VAULT_KEY, JSON.stringify({
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(ciphertext),
    branch,
  }));
};

export const unlockVault = async (passcode) => {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) throw new Error('No vault exists on this device.');
  const vault = JSON.parse(raw);
  const key = await deriveKey(passcode, fromBase64(vault.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv) }, key, fromBase64(vault.data));
    return { token: decoder.decode(plain), branch: vault.branch || 'main' };
  } catch {
    throw new Error('Wrong passcode. Try again, or forget this device and set it up afresh.');
  }
};

export const forgetVault = () => localStorage.removeItem(VAULT_KEY);
