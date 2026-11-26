-- Proteção anti-spam/rate limit no chat da mesa:
-- 1) Índice composto para checagem instantânea de rajadas por autor na sala
-- 2) Cooldown mínimo de 1.2s entre mensagens e teto de 5 mensagens a cada 10s

CREATE INDEX IF NOT EXISTS idx_mensagens_chat_rate
  ON public.mensagens_chat (partida_id, autor_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.enviar_mensagem_chat(
  p_partida uuid,
  p_conta uuid,
  p_token uuid,
  p_texto text,
  p_jogador uuid DEFAULT NULL::uuid,
  p_segredo uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limpo text;
  v_autor_id uuid;
  v_autor_nome text;
  v_msg public.mensagens_chat%ROWTYPE;
  v_recentes int;
BEGIN
  IF p_partida IS NULL THEN
    RAISE EXCEPTION 'Sala inválida.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.partidas WHERE id = p_partida AND NOT encerrada) THEN
    RAISE EXCEPTION 'Esta sala já foi encerrada.';
  END IF;

  v_limpo := btrim(regexp_replace(COALESCE(p_texto, ''), E'[\\r\\n\\t]+', ' ', 'g'));
  IF char_length(v_limpo) = 0 THEN
    RAISE EXCEPTION 'Digite uma mensagem.';
  END IF;
  IF char_length(v_limpo) > 240 THEN
    v_limpo := left(v_limpo, 240);
  END IF;

  -- Identifica pelo jogador ativo na sala (funciona também ao alternar jogadores no modo DEV)
  IF p_jogador IS NOT NULL AND p_segredo IS NOT NULL THEN
    SELECT j.id, j.nome
    INTO v_autor_id, v_autor_nome
    FROM public.jogadores j
    JOIN public.segredos s ON s.jogador_id = j.id
    WHERE j.id = p_jogador
      AND j.partida_id = p_partida
      AND s.segredo = p_segredo;
  END IF;

  -- Fallback: conta logada
  IF v_autor_nome IS NULL AND p_conta IS NOT NULL AND p_token IS NOT NULL THEN
    SELECT id, nome
    INTO v_autor_id, v_autor_nome
    FROM public.contas
    WHERE id = p_conta
      AND token = p_token;
  END IF;

  IF v_autor_nome IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida para enviar mensagem.';
  END IF;

  -- Rate limit por autor na sala: mínimo 1.2s entre mensagens e máximo 5 em 10s
  IF EXISTS (
    SELECT 1 FROM public.mensagens_chat
    WHERE partida_id = p_partida
      AND autor_id = v_autor_id
      AND criado_em > now() - interval '1.2 seconds'
  ) THEN
    RAISE EXCEPTION 'Calma! Aguarde um instante antes de enviar outra mensagem.';
  END IF;

  SELECT count(*) INTO v_recentes
  FROM (
    SELECT 1 FROM public.mensagens_chat
    WHERE partida_id = p_partida
      AND autor_id = v_autor_id
      AND criado_em > now() - interval '10 seconds'
    LIMIT 5
  ) r;

  IF v_recentes >= 5 THEN
    RAISE EXCEPTION 'Muitas mensagens seguidas. Aguarde alguns segundos.';
  END IF;

  INSERT INTO public.mensagens_chat (partida_id, autor_id, autor_nome, texto)
  VALUES (p_partida, v_autor_id, v_autor_nome, v_limpo)
  RETURNING * INTO v_msg;

  RETURN jsonb_build_object(
    'id', v_msg.id,
    'autor_id', v_msg.autor_id,
    'autor_nome', v_msg.autor_nome,
    'texto', v_msg.texto,
    'criado_em', v_msg.criado_em
  );
END;
$function$;
