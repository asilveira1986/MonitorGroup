import type { MetadataRoute } from 'next';

/** App instalável (Tela de Início no iPhone, atalho no Android e no computador): necessário para o push no iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Monitor Group',
    short_name: 'Monitor Group',
    description: 'Monitoramento de grupos de WhatsApp: garanta que todo cliente seja respondido.',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#0b1220',
    theme_color: '#0b1220',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
