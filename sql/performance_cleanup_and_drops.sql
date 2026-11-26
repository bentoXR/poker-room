-- =====================================================================
-- POKER ROOM: Parte final (DROP / DELETE) para rodar no SQL Editor do Supabase
-- (Os índices novos, search_path, cron */2 e todas as RPCs sem DELETE já foram aplicados)
-- =====================================================================

-- 1. Remover tabelas não assinadas da publicação Realtime
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'historico'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.historico;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'jogadores'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.jogadores;
  END IF;
END $$;

-- 2. Remover índices antigos substituídos / sem uso
DROP INDEX IF EXISTS public.historico_partida_id_id_idx;
DROP INDEX IF EXISTS public.jogadores_partida_idx;
DROP INDEX IF EXISTS public.idx_partidas_ativas_ultima_mao;

-- 3. Limpar 1.068+ contas DEV órfãs, operacoes_fichas antigas e logs do cron
DELETE FROM public.contas c
WHERE c.nome ~* '\sDEV\s[0-9a-z]{3,8}'
  AND NOT EXISTS (SELECT 1 FROM public.jogadores j WHERE j.conta_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.fichas_guardadas fg WHERE fg.conta_id = c.id);

DELETE FROM public.operacoes_fichas
WHERE criada_em < now() - interval '24 hours';

DO $$
BEGIN
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '2 days';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 4. Atualizar funções que contêm DELETE (coalesce + limpeza automática)
CREATE OR REPLACE FUNCTION public.tirar_jogador_da_partida(p_partida uuid, p_jogador uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  update partidas
  set vez_jogador_id      = case when vez_jogador_id = p_jogador then null else vez_jogador_id end,
      dealer_jogador_id   = case when dealer_jogador_id = p_jogador then null else dealer_jogador_id end,
      sb_jogador_id       = case when sb_jogador_id = p_jogador then null else sb_jogador_id end,
      bb_jogador_id       = case when bb_jogador_id = p_jogador then null else bb_jogador_id end,
      primeiro_jogador_id = case when primeiro_jogador_id = p_jogador then null else primeiro_jogador_id end
  where id = p_partida
    and p_jogador in (vez_jogador_id, dealer_jogador_id, sb_jogador_id, bb_jogador_id, primeiro_jogador_id);

  delete from presenca where jogador_id = p_jogador;
  delete from jogadores where id = p_jogador;

  update jogadores set ordem = -ordem where partida_id = p_partida;
  update jogadores j set ordem = r.n
  from (select id, row_number() over (order by ordem desc) as n
        from jogadores where partida_id = p_partida) r
  where j.id = r.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dev_apagar_sala(p_conta uuid, p_token uuid, p_partida text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
  v_contas uuid[];
BEGIN
  PERFORM public.conferir_conta_dev(p_conta, p_token);

  BEGIN
    v_pid := p_partida::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN true;
  END;

  SELECT array_agg(DISTINCT j.conta_id) INTO v_contas
  FROM public.jogadores j
  WHERE j.partida_id = v_pid AND j.conta_id IS NOT NULL;

  UPDATE public.partidas
  SET encerrada = true,
      vez_jogador_id = NULL,
      sb_jogador_id = NULL,
      bb_jogador_id = NULL,
      primeiro_jogador_id = NULL,
      dealer_jogador_id = NULL
  WHERE id = v_pid AND dev;

  BEGIN
    PERFORM public.limpar_salas_inativas();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF v_contas IS NOT NULL THEN
    DELETE FROM public.contas c
    WHERE c.id = ANY(v_contas)
      AND c.nome ~* '\sDEV\s[0-9a-z]{3,8}'
      AND NOT EXISTS (SELECT 1 FROM public.jogadores j WHERE j.conta_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.fichas_guardadas fg WHERE fg.conta_id = c.id);
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.limpar_salas_inativas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_limite interval := interval '1 hours';
  v_ids    uuid[];
  v_qtd    int := 0;
begin
  if exists (select 1 from public.partidas) then
    select array_agg(p.id) into v_ids
    from public.partidas p
    where p.encerrada
       or not exists (
         select 1
         from public.jogadores j
         left join public.presenca pr on pr.jogador_id = j.id
         where j.partida_id = p.id
           and coalesce(pr.ultimo_sinal, j.criado_em) > now() - v_limite
       );

    if v_ids is not null then
      update public.partidas
      set vez_jogador_id = null, sb_jogador_id = null,
          bb_jogador_id = null, primeiro_jogador_id = null
      where id = any(v_ids);

      delete from public.operacoes_fichas where partida_id = any(v_ids);
      delete from public.historico where partida_id = any(v_ids);
      delete from public.presenca  where partida_id = any(v_ids);
      delete from public.segredos  where jogador_id in (select id from public.jogadores where partida_id = any(v_ids));
      delete from public.jogadores where partida_id = any(v_ids);
      delete from public.partidas  where id = any(v_ids);

      v_qtd := array_length(v_ids, 1);
    end if;
  end if;

  delete from public.contas c
  where (
    (c.nome ~* '\sDEV\s[0-9a-z]{3,8}' and c.criada_em < now() - interval '2 hours')
    or (c.convidado and c.criada_em < now() - interval '7 days')
  )
    and not exists (select 1 from public.jogadores j where j.conta_id = c.id)
    and not exists (select 1 from public.fichas_guardadas fg where fg.conta_id = c.id);

  begin
    delete from cron.job_run_details where start_time < now() - interval '2 days';
  exception when others then
    null;
  end;

  return v_qtd;
end;
$function$;
