import { cn } from '@/lib/format';

/**
 * Símbolo da identidade Monitor Group: balão de conversa em verde-limão (o grupo),
 * pulso em forma de M (o monitoramento) e o ponto de alerta.
 * O anel do ponto usa a cor da superfície por trás (--surface), então funciona
 * no fundo claro, no escuro e no menu lateral (deep) sem trocar de arquivo.
 * Abaixo de 20px o ponto de alerta sai, como pede o guia da marca.
 */
export function LogoMark({ size = 36, className, alertDot = size >= 20 }: { size?: number; className?: string; alertDot?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn('shrink-0', className)} role="img" aria-label="Monitor Group">
      <path fill="#C6F432" d="M20 6h24a14 14 0 0 1 14 14v18a14 14 0 0 1-14 14H25l-11 8v-9.2A14 14 0 0 1 6 38V20A14 14 0 0 1 20 6z" />
      <polyline
        fill="none"
        stroke="#0E1726"
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points="13,30 19,30 24.5,19 32,39 39.5,19 45,30 51,30"
      />
      {alertDot && (
        <>
          <circle cx="53" cy="11" r="8" fill="var(--surface)" />
          <circle cx="53" cy="11" r="5.5" fill="var(--mark-alert)" />
        </>
      )}
    </svg>
  );
}

/** Assinatura horizontal: símbolo + "Monitor" (Sora Bold) "Group" (Sora Regular). */
export function Logo({
  compact = false,
  size = 36,
  className,
  textClassName = 'text-[1.15rem]',
}: {
  compact?: boolean;
  size?: number;
  className?: string;
  /** tamanho do nome (ex.: menor no menu lateral) */
  textClassName?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      {!compact && (
        <p className={cn('font-display whitespace-nowrap leading-none tracking-[-0.02em] text-ink', textClassName)}>
          <span className="font-bold">Monitor</span> <span className="font-normal">Group</span>
        </p>
      )}
    </div>
  );
}
