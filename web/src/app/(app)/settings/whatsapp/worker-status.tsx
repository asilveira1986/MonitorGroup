"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ServerCrash,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";

type Status =
  | { kind: "loading" }
  | { kind: "no-table"; message: string }
  | { kind: "never" }
  | { kind: "offline"; lastSeen: string }
  | {
      kind: "online";
      lastSeen: string;
      whatsappVersion: string | null;
      duplicate: string | null;
    };

const OFFLINE_AFTER_MS = 70_000;

/** Mostra se o worker do WhatsApp (Railway) está no ar. */
export function WorkerStatus({
  onChange,
}: {
  onChange?: (online: boolean | null) => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    const load = async () => {
      const { data: rows, error } = await supabase
        .from("worker_status")
        .select("id, last_seen_at, whatsapp_version, info")
        .in("id", ["main", "standby"]);
      if (!alive) return;
      const data = rows?.find((r) => r.id === "main");
      // outra cópia do worker aguardando a vez (2 réplicas, deploy em andamento ou worker rodando no computador)
      const standby = rows?.find(
        (r) =>
          r.id === "standby" &&
          Date.now() - new Date(r.last_seen_at).getTime() < OFFLINE_AFTER_MS,
      );
      const duplicate = standby
        ? String(
            (standby.info as { host?: string } | null)?.host ??
              "outro servidor",
          )
        : null;
      let next: Status;
      if (error) next = { kind: "no-table", message: error.message };
      else if (!data) next = { kind: "never" };
      else if (
        Date.now() - new Date(data.last_seen_at).getTime() >
        OFFLINE_AFTER_MS
      )
        next = { kind: "offline", lastSeen: data.last_seen_at };
      else
        next = {
          kind: "online",
          lastSeen: data.last_seen_at,
          whatsappVersion: data.whatsapp_version,
          duplicate,
        };
      setStatus(next);
      onChange?.(
        next.kind === "online" ? true : next.kind === "no-table" ? null : false,
      );
    };
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [onChange]);

  if (status.kind === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando o worker do
        WhatsApp…
      </div>
    );
  }

  if (status.kind === "online") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-good/10 px-4 py-3 text-sm text-good-ink">
          <CheckCircle2 className="h-4 w-4" />
          <span className="font-medium">Worker do WhatsApp no ar</span>
          <span className="text-xs opacity-80">
            · último sinal {timeAgo(status.lastSeen)}
            {status.whatsappVersion &&
              ` · WhatsApp Web ${status.whatsappVersion}`}
          </span>
        </div>
        {status.duplicate && (
          <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" />
            <div>
              <p className="font-semibold">
                Há outra cópia do worker ligada ({status.duplicate})
              </p>
              <p className="mt-1 text-ink-2">
                Ela está aguardando e não se conecta ao WhatsApp. Se não for um
                deploy em andamento, desligue a cópia extra: deixe{" "}
                <strong>1 réplica</strong> no Railway e não rode o worker no seu
                computador com as mesmas variáveis. Duas cópias com a mesma
                sessão fazem o WhatsApp derrubar a conexão (erro 428).
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (status.kind === "no-table") {
    return (
      <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" />
        <div>
          <p className="font-semibold">Não foi possível verificar o worker</p>
          <p className="mt-1 text-ink-2">
            Execute o script{" "}
            <code>supabase/migrations/0005_worker_status.sql</code> no SQL
            Editor do Supabase para ativar este diagnóstico.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 rounded-xl border border-critical/40 bg-critical/10 px-4 py-3 text-sm">
      <ServerCrash className="mt-0.5 h-4 w-4 shrink-0 text-critical-ink" />
      <div>
        <p className="font-semibold text-critical-ink">
          {status.kind === "never"
            ? "O worker do WhatsApp ainda não se conectou ao banco"
            : `O worker do WhatsApp está fora do ar (último sinal ${timeAgo(status.lastSeen)})`}
        </p>
        <p className="mt-1 text-ink-2">
          É ele que gera o QR code. Sem ele, a conexão fica parada em
          &quot;Gerando QR code…&quot;. No Railway, confira:
        </p>
        <ol className="mt-1 list-inside list-decimal space-y-0.5 text-ink-2">
          <li>
            O serviço está com status <strong>Active/Online</strong> e o log
            mostra <code>worker do MonitorGroup no ar</code>.
          </li>
          <li>
            <strong>Settings › Root Directory</strong> = <code>worker</code>.
          </li>
          <li>
            <strong>Variables</strong>: <code>SUPABASE_URL</code> (a mesma
            Project URL do painel) e <code>SUPABASE_SERVICE_ROLE_KEY</code>{" "}
            (chave <em>service_role</em>/secret, não a anon).
          </li>
          <li>Depois de alterar variáveis, faça um novo deploy.</li>
        </ol>
      </div>
    </div>
  );
}
