-- Endurecimento para lançamento público (Stage 2):
-- 1) Revoga EXECUTE direto da API (anon/authenticated) em funções internas e triggers SECURITY DEFINER
-- 2) Adiciona índices de FK faltantes em amizades e convites_sala
-- 3) Adiciona triggers de moderação de nomes e proteção anti-flood global em contas e partidas

-- =====================================================================
-- 1. Revogar execução direta pela API em funções internas e triggers
-- =====================================================================
REVOKE ALL ON FUNCTION public._sair_jogador_interno(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adicionar_bot_sala(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gerenciar_bots_sala(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.liberar_vaga_bot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promover_espera_vaga_bot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.passo_aposta(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_contar_maos_vencidas_online() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verificar_senha_ao_entrar() FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- 2. Índices de foreign keys faltantes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_amizades_solicitante_id
  ON public.amizades (solicitante_id);

CREATE INDEX IF NOT EXISTS idx_convites_sala_remetente_id
  ON public.convites_sala (remetente_id);

-- =====================================================================
-- 3. Validação de nome e proteção anti-flood para contas e salas
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trg_validar_nome_conta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.nome IS NOT DISTINCT FROM OLD.nome THEN
    RETURN NEW;
  END IF;

  v_norm := lower(regexp_replace(trim(coalesce(NEW.nome, '')), '\s+', ' ', 'g'));

  IF v_norm IN (
    'admin', 'administrador', 'moderator', 'moderador', 'suporte',
    'sistema', 'poker room', 'pokerroom', 'staff', 'oficial', 'support'
  ) THEN
    RAISE EXCEPTION 'Esse nome não é permitido. Escolha outro.';
  END IF;

  IF v_norm ~ '\m(porra|caralho|puta|viado|buceta|arrombado|arrombada|foda-se|fodase|desgraca|desgraça|nigger|nigga|faggot|hitler|nazista)\M' THEN
    RAISE EXCEPTION 'Esse nome não é permitido. Escolha outro.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_validar_nome_conta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contas_validar_nome ON public.contas;
CREATE TRIGGER trg_contas_validar_nome
  BEFORE INSERT OR UPDATE OF nome ON public.contas
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validar_nome_conta();

CREATE OR REPLACE FUNCTION public.trg_limitar_flood_contas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_recentes int;
BEGIN
  SELECT count(*) INTO v_recentes
  FROM (
    SELECT 1
    FROM public.contas
    WHERE criada_em > now() - interval '1 minute'
    LIMIT 40
  ) q;

  IF v_recentes >= 40 THEN
    RAISE EXCEPTION 'Muitos cadastros neste momento. Tente novamente em alguns segundos.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_limitar_flood_contas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contas_limitar_flood ON public.contas;
CREATE TRIGGER trg_contas_limitar_flood
  BEFORE INSERT ON public.contas
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_limitar_flood_contas();

CREATE OR REPLACE FUNCTION public.trg_limitar_flood_salas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_recentes int;
  v_abertas int;
BEGIN
  IF COALESCE(NEW.dev, false) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_recentes
  FROM (
    SELECT 1
    FROM public.partidas
    WHERE criada_em > now() - interval '1 minute'
      AND NOT COALESCE(dev, false)
    LIMIT 15
  ) q;

  IF v_recentes >= 15 THEN
    RAISE EXCEPTION 'Muitas salas abertas neste momento. Aguarde um instante ou entre em uma sala existente.';
  END IF;

  SELECT count(*) INTO v_abertas
  FROM (
    SELECT 1
    FROM public.partidas
    WHERE NOT encerrada
      AND NOT COALESCE(dev, false)
    LIMIT 200
  ) q;

  IF v_abertas >= 200 THEN
    RAISE EXCEPTION 'Muitas salas abertas neste momento. Aguarde um instante ou entre em uma sala existente.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_limitar_flood_salas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_partidas_limitar_flood ON public.partidas;
CREATE TRIGGER trg_partidas_limitar_flood
  BEFORE INSERT ON public.partidas
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_limitar_flood_salas();
