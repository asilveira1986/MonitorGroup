import type { Metadata, Viewport } from 'next';
import { DM_Sans, JetBrains_Mono, Sora } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

// tipografia da identidade visual Monitor Group
const dmSans = DM_Sans({ variable: '--font-dm-sans', subsets: ['latin'] });
const sora = Sora({ variable: '--font-sora', subsets: ['latin'], weight: ['400', '600', '700'] });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], weight: ['500'] });

export const metadata: Metadata = {
  title: 'Monitor Group',
  description: 'Monitoramento de grupos de WhatsApp: garanta que todo cliente seja respondido.',
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
