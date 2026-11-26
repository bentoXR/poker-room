-- Endurecimento pós-Turnstile e limpeza automática de dados antigos:
-- 1) Fecha o bypass do Turnstile: só a Edge Function (service_role) pode criar contas
-- 2) Cria função limpar_dados_antigos() e agenda diariamente via pg_cron (se ativo)

-- =====================================================================
-- 1. Exigir Turnstile (bloquear chamadas diretas via anon/authenticated)
-- =====================================================================
REVOKE ALL ON FUNCTION public.criar_conta(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.criar_conta_convidado(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.criar_conta(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.criar_conta_convidado(text) TO service_role;

-- =====================================================================
-- 2. Limpeza automática de salas encerradas e contas Convidado inativas
-- =====================================================================
CREATE OR REPLACE FUNCTION public.limpar_dados_antigos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Remove salas encerradas há mais de 14 dias
  DELETE FROM public.partidas
  WHERE encerrada = true
    AND coalesce(ultima_mao_em, criada_em) < now() - interval '14 days';

  -- Remove contas Convidado sem acesso há mais de 30 dias e sem partida ativa
  DELETE FROM public.contas c
  WHERE c.convidado = true
    AND c.partida_atual_id IS NULL
    AND coalesce(c.ultimo_acesso, c.criada_em) < now() - interval '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.jogadores j WHERE j.conta_id = c.id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.limpar_dados_antigos() FROM PUBLIC, anon, authenticated;

-- Agenda execução diária às 04:00 UTC caso pg_cron esteja habilitado no projeto
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('poker_room_limpeza_diaria')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poker_room_limpeza_diaria');

    PERFORM cron.schedule(
      'poker_room_limpeza_diaria',
      '0 4 * * *',
      $cron$SELECT public.limpar_dados_antigos();$cron$
    );
  END IF;
END
$$;
