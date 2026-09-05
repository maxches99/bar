// Вход по парольной фразе. Фраза расшифровывает GitHub-токен, лежащий в репозитории
// в виде AES-GCM блоба. В открытом виде токен существует только в памяти вкладки
// и в localStorage этого устройства — вводить его руками нигде не нужно.
const STORE_KEY = 'bar.token';
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const getToken = () => localStorage.getItem(STORE_KEY);
export const lock = () => localStorage.removeItem(STORE_KEY);

export async function unlock(passphrase) {
  const blob = await fetch('auth.enc.json', { cache: 'no-store' }).then((r) => r.json());
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(blob.salt), iterations: blob.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  // Неверная фраза не пройдёт проверку тега AES-GCM — decrypt бросит исключение.
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, key, b64(blob.ct));
  const token = new TextDecoder().decode(plain);
  localStorage.setItem(STORE_KEY, token);
  return token;
}
