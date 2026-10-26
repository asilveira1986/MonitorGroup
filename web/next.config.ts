import type { NextConfig } from "next";

/** Cabeçalhos de segurança em todas as páginas e arquivos do painel. */
const securityHeaders = [
  // não abre dentro de outro site (clickjacking)
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // microfone só para gravar áudio no próprio painel; nada de câmera, localização etc.
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
