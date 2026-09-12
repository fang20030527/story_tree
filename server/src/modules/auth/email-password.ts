import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const HASH_PREFIX = 'scrypt-v1';
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

export async function hashEmailPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password, salt);
  return [
    HASH_PREFIX,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyEmailPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [prefix, encodedSalt, encodedKey] = encodedHash.split('$');
  if (prefix !== HASH_PREFIX || !encodedSalt || !encodedKey) return false;

  try {
    const salt = Buffer.from(encodedSalt, 'base64url');
    const expected = Buffer.from(encodedKey, 'base64url');
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}
