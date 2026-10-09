export const VAULT_ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: VAULT_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(data, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)));
  return {
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: VAULT_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function createVault(data, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 14) {
    throw new Error('Use a passphrase of at least 14 characters.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encrypt(data, await deriveKey(passphrase, salt), salt);
}

export async function openVault(envelope, passphrase) {
  try {
    if (envelope?.version !== 1 || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.cipher !== 'AES-256-GCM' || envelope.iterations !== VAULT_ITERATIONS) {
      throw new Error();
    }
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error();
    const key = await deriveKey(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return { data: JSON.parse(decoder.decode(plaintext)), key, salt };
  } catch {
    throw new Error('Incorrect passphrase or encrypted data is damaged.');
  }
}

export function sealVault(data, key, salt) {
  return encrypt(data, key, salt);
}