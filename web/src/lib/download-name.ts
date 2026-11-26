/**
 * Nome do arquivo que o navegador grava ao baixar um anexo (?download=1 de /media e /private-media).
 *
 * Para documento, o texto da mensagem (a legenda, ou o nome do arquivo quando não há legenda) vira o nome. Só que a legenda não
 * tem extensão ("Vê se agora foi"): o arquivo baixava sem o ".pdf" e não abria. A extensão certa é a do arquivo guardado (definida
 * pelo tipo dele quando entrou), então é ela que fecha o nome. Como isto roda na hora de baixar, vale também para as mensagens antigas.
 */
const INVALID = /[\\/:*?"<>|\u0000-\u001f]+/g;
const MAX_NAME = 80;

export function downloadName(m: { type: string; body: string | null; id: string; path: string }): string {
  // extensão só do nome do arquivo (depois da última barra), e só se houver ponto
  const file = m.path.split('/').pop() ?? '';
  const ext = (file.includes('.') ? (file.split('.').pop() ?? '') : '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const fallback = `${m.type}-${m.id.slice(0, 8)}.${ext}`;
  if (m.type !== 'document') return fallback;
  // sem os caracteres que o sistema de arquivos não aceita, sem quebra de linha, e sem ponto/espaço sobrando no fim
  let name = (m.body ?? '').replace(INVALID, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME);
  name = name.replace(/[.\s]+$/, '');
  if (!name) return fallback;
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}
