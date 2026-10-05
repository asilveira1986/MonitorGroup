-- =====================================================================
-- Horários de pico mais fácil de ler.
--
-- Além do mapa dia × hora, o indicador passa a devolver:
--   highlights: frases-resumo (pico, dia mais movimentado, fora do expediente)
--   by_hour:    total de mensagens de clientes por hora do dia (0h a 23h)
--   by_day:     total por dia da semana (segunda a domingo)
--   business:   horário comercial, para destacar o expediente no gráfico
-- O painel desenha o resumo e os dois gráficos; o mapa fica como detalhe.
-- =====================================================================

create or replace function public.ind_horarios_pico(f jsonb, p jsonb)
returns jsonb
language sql stable set search_path = public
as $$
  with m as (
    select extract(isodow from sent_at at time zone (f->>'tz'))::int as dw,   -- 1 = segunda ... 7 = domingo
           extract(hour from sent_at at time zone (f->>'tz'))::int as hr,
           public.is_business_time(sent_at, f) as in_business
    from public.ind_scope(f) where not from_team
  ),
  days as (
    select d, (array['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'])[d] as short,
           (array['segunda','terça','quarta','quinta','sexta','sábado','domingo'])[d] as long
    from generate_series(1, 7) d
  ),
  grid as (
    select days.d, hs.h, (select count(*) from m where m.dw = days.d and m.hr = hs.h)::int as n
    from days, generate_series(0, 23) as hs(h)
  ),
  by_hour as (select h, sum(n)::int as n from grid group by h),
  by_day as (select d, sum(n)::int as n from grid group by d),
  tot as (select count(*)::int as n, count(*) filter (where not in_business)::int as outside from m),
  -- pico = hora do dia com mais mensagens somando todos os dias (o mesmo destacado no gráfico)
  peak as (select h, n from by_hour order by n desc, h limit 1),
  peak_hour_day as (
    select g.d from grid g, peak where g.h = peak.h order by g.n desc, g.d limit 1
  ),
  peak_day as (select d, n from by_day order by n desc, d limit 1),
  -- faixa de 2 horas seguidas mais movimentada (no dia típico)
  peak_window as (
    select h, n + coalesce((select b2.n from by_hour b2 where b2.h = b1.h + 1), 0) as n2
    from by_hour b1 where h < 23 order by 2 desc, h limit 1
  ),
  bh as (
    select extract(hour from (f->>'business_start')::time)::int as start_h,
           ceil(extract(epoch from (f->>'business_end')::time) / 3600)::int as end_h
  )
  select jsonb_build_object(
    'visual', 'heatmap',
    'rows', (select jsonb_agg(short order by d) from days),
    'cols', (select jsonb_agg(lpad(h::text, 2, '0') || 'h' order by h) from generate_series(0, 23) h),
    'values', (select jsonb_agg(r order by d) from (select d, jsonb_agg(n order by h) as r from grid group by d) x),
    'total', (select n from tot),
    'by_hour', (select jsonb_agg(jsonb_build_object('label', lpad(h::text, 2, '0') || 'h', 'value', n) order by h) from by_hour),
    'by_day', (select jsonb_agg(jsonb_build_object('label', days.short, 'value', by_day.n) order by days.d)
               from by_day join days using (d)),
    'business', (select jsonb_build_object('start_hour', start_h, 'end_hour', end_h,
                   'days', coalesce(f->'business_days', '[]'::jsonb)) from bh),
    'highlights', case when (select n from tot) = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'label', 'Horário de pico',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 1)::text, 2, '0') || 'h' from peak),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens · mais forte ' ||
                          (select case when days.d in (6, 7) then 'no ' else 'na ' end || days.long from peak_hour_day join days using (d))
                   from peak)),
      jsonb_build_object(
        'label', 'Faixa mais movimentada',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 2)::text, 2, '0') || 'h' from peak_window),
        'detail', (select round(100.0 * n2 / nullif((select n from tot), 0)) || '% das mensagens do período' from peak_window)),
      jsonb_build_object(
        'label', 'Dia mais movimentado',
        'value', (select initcap(days.long) from peak_day join days using (d)),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens' from peak_day)),
      jsonb_build_object(
        'label', 'Fora do expediente',
        'value', (select round(100.0 * outside / nullif(n, 0)) || '%' from tot),
        'detail', (select outside || ' de ' || n || ' mensagens' from tot),
        'tone', (select case when 100.0 * outside / nullif(n, 0) >= 30 then 'warning' end from tot))
    ) end,
    'hint', case when (select n from tot) = 0 then 'Sem mensagens de clientes no período'
                 else (select n || ' mensagens de clientes no período' from tot) end
  )
$$;

-- funções de cálculo só pelos despachantes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ind\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

update public.indicators
set description = 'Quando os clientes mais escrevem: horário e dia de pico, movimento por hora e por dia da semana e quanto chega fora do expediente.'
where key = 'horarios_pico';

notify pgrst, 'reload schema';
