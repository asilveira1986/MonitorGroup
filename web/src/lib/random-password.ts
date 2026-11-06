/** Senha inicial aleatória, fácil de ditar (sem caracteres parecidos como 0/O e 1/l/I). Só no navegador. */
export function randomPassword(length = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}
