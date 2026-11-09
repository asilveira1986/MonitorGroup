import { redirect } from 'next/navigation';

export default function Home() {
  // o sistema abre no Painel de grupos (quem não tem esse menu cai no primeiro menu liberado, em requireMenu)
  redirect('/panel');
}
