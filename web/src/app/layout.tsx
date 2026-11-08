import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import './globals.css';

// tipografia da identidade visual Monitor Group. Os arquivos ficam em ./fonts (o build não baixa nada do Google)
const dmSans = localFont({ src: './fonts/dm-sans-latin-wght-normal.woff2', variable: '--font-dm-sans', weight: '100 1000', display: 'swap' });
const sora = localFont({ src: './fonts/sora-latin-wght-normal.woff2', variable: '--font-sora', weight: '100 800', display: 'swap' });
const jetbrains = localFont({ src: './fonts/jetbrains-mono-latin-500-normal.woff2', variable: '--font-jetbrains', weight: '500', display: 'swap' });

export const metadata: Metadata = {
  title: 'Monitor Group',
  description: 'Monitoramento de grupos de WhatsApp: garanta que todo cliente seja respondido.',
  // aberto pela Tela de Início do iPhone: tela cheia, como app (e com notificações push)
  appleWebApp: { capable: true, title: 'Monitor Group', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

// aplica o tema salvo antes da primeira pintura (evita "piscar")
// e o menu lateral recolhido, se foi a última escolha
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;if(localStorage.getItem('sidebar')==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${dmSans.variable} ${sora.variable} ${jetbrains.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
