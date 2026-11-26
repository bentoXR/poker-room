-- Permite reenviar convites após recusa, mas silencia o remetente por 3 minutos
-- caso o destinatário recuse 3 convites seguidos.

ALTER TABLE public.convites_sala
  ADD COLUMN IF NOT EXISTS respondido_em timestamptz;

CREATE OR REPLACE FUNCTION public.recusar_convite_sala(
  p_conta uuid,
  p_token uuid,
  p_convite_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  UPDATE public.convites_sala
  SET status = 'recusado',
      respondido_em = now()
  WHERE id = p_convite_id
    AND destinatario_id = p_conta
    AND status = 'pendente';
END;
$function$;

CREATE OR REPLACE FUNCTION public.enviar_convite_sala(
  p_conta uuid,
  p_token uuid,
  p_destinatario_id uuid,
  p_partida_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eu public.contas;
  v_dest public.contas;
  v_convite_id uuid;
  v_recusas int := 0;
  v_ultima_recusa timestamptz;
  v_restante int;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  IF p_conta = p_destinatario_id THEN
    RAISE EXCEPTION 'Você não pode convidar a si mesmo.';
  END IF;

  SELECT * INTO v_eu FROM public.contas WHERE id = p_conta;
  IF v_eu.convidado THEN
    RAISE EXCEPTION 'Crie uma senha no seu perfil para convidar amigos.';
  END IF;

  SELECT * INTO v_dest FROM public.contas WHERE id = p_destinatario_id;
  IF NOT FOUND OR v_dest.convidado THEN
    RAISE EXCEPTION 'Esse jogador não pode receber convites.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.amizades
    WHERE conta_menor = LEAST(p_conta, p_destinatario_id)
      AND conta_maior = GREATEST(p_conta, p_destinatario_id)
      AND ativa
      AND status = 'aceita'
  ) THEN
    RAISE EXCEPTION 'Vocês precisam ser amigos para enviar convite.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.partidas
    WHERE id = p_partida_id AND NOT encerrada AND NOT dev
  ) THEN
    RAISE EXCEPTION 'Essa sala não está mais ativa.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jogadores
    WHERE partida_id = p_partida_id AND conta_id = p_conta
  ) THEN
    RAISE EXCEPTION 'Entre na sala antes de convidar amigos.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.jogadores
    WHERE partida_id = p_partida_id AND conta_id = p_destinatario_id
  ) THEN
    RAISE EXCEPTION 'Esse amigo já está nesta sala.';
  END IF;

  -- Verifica se os últimos 3 convites para este amigo foram recusados recentemente (silêncio de 3 min)
  SELECT
    count(*) FILTER (WHERE status = 'recusado'),
    max(coalesce(respondido_em, criado_em))
  INTO v_recusas, v_ultima_recusa
  FROM (
    SELECT status, respondido_em, criado_em
    FROM public.convites_sala
    WHERE remetente_id = p_conta
      AND destinatario_id = p_destinatario_id
    ORDER BY criado_em DESC
    LIMIT 3
  ) ultimos;

  IF v_recusas = 3 AND v_ultima_recusa IS NOT NULL AND v_ultima_recusa > now() - interval '3 minutes' THEN
    v_restante := greatest(1, ceil(extract(epoch FROM ((v_ultima_recusa + interval '3 minutes') - now())))::int);
    IF v_restante >= 60 THEN
      RAISE EXCEPTION 'Convites silenciados após 3 recusas. Aguarde %m %s.', (v_restante / 60), lpad((v_restante % 60)::text, 2, '0');
    ELSE
      RAISE EXCEPTION 'Convites silenciados após 3 recusas. Aguarde %s.', v_restante;
    END IF;
  END IF;

  SELECT id INTO v_convite_id
  FROM public.convites_sala
  WHERE partida_id = p_partida_id
    AND destinatario_id = p_destinatario_id
    AND status = 'pendente'
    AND expira_em > now()
  ORDER BY criado_em DESC
  LIMIT 1;

  IF v_convite_id IS NOT NULL THEN
    UPDATE public.convites_sala
    SET remetente_id = p_conta,
        criado_em = now(),
        expira_em = now() + interval '15 minutes'
    WHERE id = v_convite_id;
  ELSE
    INSERT INTO public.convites_sala (partida_id, remetente_id, destinatario_id)
    VALUES (p_partida_id, p_conta, p_destinatario_id)
    RETURNING id INTO v_convite_id;
  END IF;

  RETURN jsonb_build_object(
    'convite_id', v_convite_id,
    'partida_id', p_partida_id,
    'destinatario_id', p_destinatario_id
  );
END;
$function$;
