-- Sistema de Amizades, Perfis Públicos, Presença Online e Convites de Partida

-- 1. Colunas de presença em contas + índice de busca normalizada
ALTER TABLE public.contas
  ADD COLUMN IF NOT EXISTS ultimo_acesso timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS partida_atual_id uuid NULL REFERENCES public.partidas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contas_nome_norm
  ON public.contas (lower(regexp_replace(trim(nome), '\s+', ' ', 'g')));

CREATE INDEX IF NOT EXISTS idx_contas_partida_atual
  ON public.contas (partida_atual_id)
  WHERE partida_atual_id IS NOT NULL;

-- 2. Tabela de amizades (par ordenado conta_menor < conta_maior + soft-delete com ativa)
CREATE TABLE IF NOT EXISTS public.amizades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_menor uuid NOT NULL REFERENCES public.contas(id) ON DELETE CASCADE,
  conta_maior uuid NOT NULL REFERENCES public.contas(id) ON DELETE CASCADE,
  solicitante_id uuid NOT NULL REFERENCES public.contas(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pendente', 'aceita')),
  ativa boolean NOT NULL DEFAULT true,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amizades_ordem CHECK (conta_menor < conta_maior),
  CONSTRAINT amizades_par_unico UNIQUE (conta_menor, conta_maior)
);

ALTER TABLE public.amizades ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_amizades_menor ON public.amizades (conta_menor, status);
CREATE INDEX IF NOT EXISTS idx_amizades_maior ON public.amizades (conta_maior, status);

-- 3. Tabela de convites para partidas
CREATE TABLE IF NOT EXISTS public.convites_sala (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partida_id uuid NOT NULL REFERENCES public.partidas(id) ON DELETE CASCADE,
  remetente_id uuid NOT NULL REFERENCES public.contas(id) ON DELETE CASCADE,
  destinatario_id uuid NOT NULL REFERENCES public.contas(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aceito', 'recusado', 'expirado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

ALTER TABLE public.convites_sala ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_convites_dest_pendente
  ON public.convites_sala (destinatario_id, status, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_convites_partida
  ON public.convites_sala (partida_id);

-- 4. RPC: ping_presenca
CREATE OR REPLACE FUNCTION public.ping_presenca(
  p_conta uuid,
  p_token uuid,
  p_partida_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partida uuid := NULL;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  IF p_partida_id IS NOT NULL THEN
    SELECT p.id INTO v_partida
    FROM public.partidas p
    JOIN public.jogadores j ON j.partida_id = p.id
    WHERE p.id = p_partida_id
      AND NOT p.encerrada
      AND NOT p.dev
      AND j.conta_id = p_conta
    LIMIT 1;
  END IF;

  UPDATE public.contas
  SET ultimo_acesso = now(),
      partida_atual_id = v_partida
  WHERE id = p_conta;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ping_presenca(uuid, uuid, uuid) TO anon, authenticated;

-- 5. RPC: obter_perfil_publico
CREATE OR REPLACE FUNCTION public.obter_perfil_publico(
  p_conta uuid,
  p_token uuid,
  p_alvo_conta uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_alvo public.contas;
  v_amizade public.amizades;
  v_menor uuid;
  v_maior uuid;
  v_relacao text := 'nenhum';
  v_amizade_id uuid := NULL;
  v_online boolean;
  v_status text;
  v_partida jsonb := NULL;
  v_p public.partidas;
  v_tem_senha boolean := false;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  SELECT * INTO v_alvo FROM public.contas WHERE id = p_alvo_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogador não encontrado.';
  END IF;

  v_online := (v_alvo.ultimo_acesso > now() - interval '75 seconds');

  IF p_conta = p_alvo_conta THEN
    v_relacao := 'eu';
  ELSE
    v_menor := LEAST(p_conta, p_alvo_conta);
    v_maior := GREATEST(p_conta, p_alvo_conta);
    SELECT * INTO v_amizade
    FROM public.amizades
    WHERE conta_menor = v_menor AND conta_maior = v_maior AND ativa;

    IF FOUND THEN
      v_amizade_id := v_amizade.id;
      IF v_amizade.status = 'aceita' THEN
        v_relacao := 'amigos';
      ELSIF v_amizade.solicitante_id = p_conta THEN
        v_relacao := 'enviado';
      ELSE
        v_relacao := 'recebido';
      END IF;
    END IF;
  END IF;

  v_status := CASE WHEN v_online THEN 'online' ELSE 'offline' END;

  IF v_online AND v_alvo.partida_atual_id IS NOT NULL THEN
    SELECT p.* INTO v_p
    FROM public.partidas p
    JOIN public.jogadores j ON j.partida_id = p.id
    WHERE p.id = v_alvo.partida_atual_id
      AND NOT p.encerrada
      AND NOT p.dev
      AND j.conta_id = p_alvo_conta
    LIMIT 1;

    IF FOUND THEN
      v_status := 'em_partida';
      IF v_relacao IN ('eu', 'amigos') THEN
        SELECT EXISTS(SELECT 1 FROM public.partidas_senhas ps WHERE ps.partida_id = v_p.id)
          INTO v_tem_senha;
        v_partida := jsonb_build_object(
          'id', v_p.id,
          'nome', coalesce(nullif(trim(v_p.nome), ''), 'Sala ' || v_p.codigo),
          'modo', v_p.modo,
          'tem_senha', v_tem_senha
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'conta_id', v_alvo.id,
    'nome', v_alvo.nome,
    'avatar_url', v_alvo.avatar_url,
    'avatar_versao', v_alvo.avatar_versao,
    'convidado', v_alvo.convidado,
    'online', v_online,
    'status_presenca', v_status,
    'ultimo_acesso', v_alvo.ultimo_acesso,
    'partida_atual', v_partida,
    'relacao', v_relacao,
    'amizade_id', v_amizade_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obter_perfil_publico(uuid, uuid, uuid) TO anon, authenticated;

-- 6. RPC: buscar_conta_exata
CREATE OR REPLACE FUNCTION public.buscar_conta_exata(
  p_conta uuid,
  p_token uuid,
  p_nome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eu public.contas;
  v_norm text := lower(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  v_alvo public.contas;
  v_amizade public.amizades;
  v_relacao text := 'nenhum';
  v_amizade_id uuid := NULL;
  v_online boolean;
  v_status text;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  SELECT * INTO v_eu FROM public.contas WHERE id = p_conta;
  IF v_eu.convidado THEN
    RAISE EXCEPTION 'Crie uma senha no seu perfil para adicionar amigos.';
  END IF;

  IF length(v_norm) < 2 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_alvo
  FROM public.contas
  WHERE lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = v_norm
    AND id <> p_conta
    AND NOT convidado
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_amizade
  FROM public.amizades
  WHERE conta_menor = LEAST(p_conta, v_alvo.id)
    AND conta_maior = GREATEST(p_conta, v_alvo.id)
    AND ativa;

  IF FOUND THEN
    v_amizade_id := v_amizade.id;
    IF v_amizade.status = 'aceita' THEN
      v_relacao := 'amigos';
    ELSIF v_amizade.solicitante_id = p_conta THEN
      v_relacao := 'enviado';
    ELSE
      v_relacao := 'recebido';
    END IF;
  END IF;

  v_online := (v_alvo.ultimo_acesso > now() - interval '75 seconds');
  v_status := CASE
    WHEN v_online AND v_alvo.partida_atual_id IS NOT NULL THEN 'em_partida'
    WHEN v_online THEN 'online'
    ELSE 'offline'
  END;

  RETURN jsonb_build_object(
    'conta_id', v_alvo.id,
    'nome', v_alvo.nome,
    'avatar_url', v_alvo.avatar_url,
    'avatar_versao', v_alvo.avatar_versao,
    'online', v_online,
    'status_presenca', v_status,
    'ultimo_acesso', v_alvo.ultimo_acesso,
    'relacao', v_relacao,
    'amizade_id', v_amizade_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.buscar_conta_exata(uuid, uuid, text) TO anon, authenticated;

-- 7. RPC: sugestoes_amizade
CREATE OR REPLACE FUNCTION public.sugestoes_amizade(
  p_conta uuid,
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eu public.contas;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  SELECT * INTO v_eu FROM public.contas WHERE id = p_conta;
  IF v_eu.convidado THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.ultima_partida_em DESC), '[]'::jsonb)
    FROM (
      SELECT
        c.id AS conta_id,
        c.nome,
        c.avatar_url,
        c.avatar_versao,
        (c.ultimo_acesso > now() - interval '75 seconds') AS online,
        c.ultimo_acesso,
        max(p.criada_em) AS ultima_partida_em
      FROM public.jogadores j1
      JOIN public.partidas p ON p.id = j1.partida_id
      JOIN public.jogadores j2 ON j2.partida_id = p.id
      JOIN public.contas c ON c.id = j2.conta_id
      WHERE j1.conta_id = p_conta
        AND NOT p.dev
        AND j2.conta_id IS NOT NULL
        AND j2.conta_id <> p_conta
        AND NOT j2.eh_bot
        AND NOT c.convidado
        AND NOT EXISTS (
          SELECT 1 FROM public.amizades a
          WHERE a.conta_menor = LEAST(p_conta, c.id)
            AND a.conta_maior = GREATEST(p_conta, c.id)
            AND a.ativa
        )
      GROUP BY c.id, c.nome, c.avatar_url, c.avatar_versao, c.ultimo_acesso
      ORDER BY max(p.criada_em) DESC
      LIMIT 15
    ) s
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sugestoes_amizade(uuid, uuid) TO anon, authenticated;

-- 8. RPC: enviar_pedido_amizade
CREATE OR REPLACE FUNCTION public.enviar_pedido_amizade(
  p_conta uuid,
  p_token uuid,
  p_alvo_conta uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eu public.contas;
  v_alvo public.contas;
  v_menor uuid;
  v_maior uuid;
  v_amizade public.amizades;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  IF p_conta = p_alvo_conta THEN
    RAISE EXCEPTION 'Você não pode adicionar a si mesmo.';
  END IF;

  SELECT * INTO v_eu FROM public.contas WHERE id = p_conta;
  IF v_eu.convidado THEN
    RAISE EXCEPTION 'Crie uma senha no seu perfil para adicionar amigos.';
  END IF;

  SELECT * INTO v_alvo FROM public.contas WHERE id = p_alvo_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogador não encontrado.';
  END IF;
  IF v_alvo.convidado THEN
    RAISE EXCEPTION 'Contas Convidado não podem receber pedidos de amizade.';
  END IF;

  v_menor := LEAST(p_conta, p_alvo_conta);
  v_maior := GREATEST(p_conta, p_alvo_conta);

  PERFORM pg_advisory_xact_lock(hashtext('poker-amizade-' || v_menor::text || '-' || v_maior::text));

  SELECT * INTO v_amizade
  FROM public.amizades
  WHERE conta_menor = v_menor AND conta_maior = v_maior;

  IF FOUND THEN
    IF NOT v_amizade.ativa THEN
      UPDATE public.amizades
      SET ativa = true,
          solicitante_id = p_conta,
          status = 'pendente',
          criada_em = now(),
          atualizada_em = now()
      WHERE id = v_amizade.id
      RETURNING * INTO v_amizade;

      RETURN jsonb_build_object(
        'amizade_id', v_amizade.id,
        'status', 'pendente',
        'auto_aceita', false
      );
    ELSIF v_amizade.status = 'aceita' THEN
      RAISE EXCEPTION 'Vocês já são amigos.';
    ELSIF v_amizade.solicitante_id = p_conta THEN
      RAISE EXCEPTION 'Pedido de amizade já enviado.';
    ELSE
      UPDATE public.amizades
      SET status = 'aceita',
          atualizada_em = now()
      WHERE id = v_amizade.id
      RETURNING * INTO v_amizade;

      RETURN jsonb_build_object(
        'amizade_id', v_amizade.id,
        'status', 'aceita',
        'auto_aceita', true
      );
    END IF;
  END IF;

  INSERT INTO public.amizades (conta_menor, conta_maior, solicitante_id, status, ativa)
  VALUES (v_menor, v_maior, p_conta, 'pendente', true)
  RETURNING * INTO v_amizade;

  RETURN jsonb_build_object(
    'amizade_id', v_amizade.id,
    'status', 'pendente',
    'auto_aceita', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.enviar_pedido_amizade(uuid, uuid, uuid) TO anon, authenticated;

-- 9. RPC: responder_pedido_amizade
CREATE OR REPLACE FUNCTION public.responder_pedido_amizade(
  p_conta uuid,
  p_token uuid,
  p_amizade_id uuid,
  p_aceitar boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_amizade public.amizades;
  v_outro uuid;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  SELECT * INTO v_amizade
  FROM public.amizades
  WHERE id = p_amizade_id
    AND ativa
    AND status = 'pendente'
    AND (conta_menor = p_conta OR conta_maior = p_conta)
    AND solicitante_id <> p_conta;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de amizade não encontrado.';
  END IF;

  v_outro := CASE WHEN v_amizade.conta_menor = p_conta THEN v_amizade.conta_maior ELSE v_amizade.conta_menor END;

  IF p_aceitar THEN
    UPDATE public.amizades
    SET status = 'aceita',
        atualizada_em = now()
    WHERE id = p_amizade_id;

    RETURN jsonb_build_object('status', 'aceita', 'outro_conta_id', v_outro);
  ELSE
    UPDATE public.amizades
    SET ativa = false,
        atualizada_em = now()
    WHERE id = p_amizade_id;

    RETURN jsonb_build_object('status', 'recusado', 'outro_conta_id', v_outro);
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.responder_pedido_amizade(uuid, uuid, uuid, boolean) TO anon, authenticated;

-- 10. RPC: cancelar_ou_remover_amizade
CREATE OR REPLACE FUNCTION public.cancelar_ou_remover_amizade(
  p_conta uuid,
  p_token uuid,
  p_alvo_conta uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  UPDATE public.amizades
  SET ativa = false,
      atualizada_em = now()
  WHERE conta_menor = LEAST(p_conta, p_alvo_conta)
    AND conta_maior = GREATEST(p_conta, p_alvo_conta)
    AND ativa;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancelar_ou_remover_amizade(uuid, uuid, uuid) TO anon, authenticated;

-- 11. RPC: listar_amigos_e_pedidos
CREATE OR REPLACE FUNCTION public.listar_amigos_e_pedidos(
  p_conta uuid,
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eu public.contas;
  v_amigos jsonb;
  v_recebidos jsonb;
  v_enviados jsonb;
  v_convites jsonb;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  UPDATE public.contas
  SET ultimo_acesso = now()
  WHERE id = p_conta;

  SELECT * INTO v_eu FROM public.contas WHERE id = p_conta;

  IF v_eu.convidado THEN
    RETURN jsonb_build_object(
      'convidado', true,
      'amigos', '[]'::jsonb,
      'pedidos_recebidos', '[]'::jsonb,
      'pedidos_enviados', '[]'::jsonb,
      'convites_sala', '[]'::jsonb
    );
  END IF;

  SELECT coalesce(
    jsonb_agg(
      to_jsonb(t)
      ORDER BY t.online DESC, (t.partida_atual IS NOT NULL) DESC, t.ultimo_acesso DESC
    ),
    '[]'::jsonb
  ) INTO v_amigos
  FROM (
    SELECT
      a.id AS amizade_id,
      c.id AS conta_id,
      c.nome,
      c.avatar_url,
      c.avatar_versao,
      (c.ultimo_acesso > now() - interval '75 seconds') AS online,
      c.ultimo_acesso,
      CASE
        WHEN c.ultimo_acesso > now() - interval '75 seconds' AND p.id IS NOT NULL THEN 'em_partida'
        WHEN c.ultimo_acesso > now() - interval '75 seconds' THEN 'online'
        ELSE 'offline'
      END AS status_presenca,
      CASE
        WHEN c.ultimo_acesso > now() - interval '75 seconds' AND p.id IS NOT NULL THEN
          jsonb_build_object(
            'id', p.id,
            'nome', coalesce(nullif(trim(p.nome), ''), 'Sala ' || p.codigo),
            'modo', p.modo,
            'tem_senha', EXISTS(SELECT 1 FROM public.partidas_senhas ps WHERE ps.partida_id = p.id)
          )
        ELSE NULL
      END AS partida_atual
    FROM public.amizades a
    JOIN public.contas c
      ON c.id = CASE WHEN a.conta_menor = p_conta THEN a.conta_maior ELSE a.conta_menor END
    LEFT JOIN LATERAL (
      SELECT pt.id, pt.nome, pt.codigo, pt.modo
      FROM public.partidas pt
      JOIN public.jogadores j ON j.partida_id = pt.id
      WHERE pt.id = c.partida_atual_id
        AND NOT pt.encerrada
        AND NOT pt.dev
        AND j.conta_id = c.id
      LIMIT 1
    ) p ON true
    WHERE a.ativa
      AND a.status = 'aceita'
      AND (a.conta_menor = p_conta OR a.conta_maior = p_conta)
  ) t;

  SELECT coalesce(
    jsonb_agg(to_jsonb(r) ORDER BY r.criada_em DESC),
    '[]'::jsonb
  ) INTO v_recebidos
  FROM (
    SELECT
      a.id AS amizade_id,
      c.id AS conta_id,
      c.nome,
      c.avatar_url,
      c.avatar_versao,
      (c.ultimo_acesso > now() - interval '75 seconds') AS online,
      c.ultimo_acesso,
      a.criada_em
    FROM public.amizades a
    JOIN public.contas c ON c.id = a.solicitante_id
    WHERE a.ativa
      AND a.status = 'pendente'
      AND (a.conta_menor = p_conta OR a.conta_maior = p_conta)
      AND a.solicitante_id <> p_conta
  ) r;

  SELECT coalesce(
    jsonb_agg(to_jsonb(e) ORDER BY e.criada_em DESC),
    '[]'::jsonb
  ) INTO v_enviados
  FROM (
    SELECT
      a.id AS amizade_id,
      c.id AS conta_id,
      c.nome,
      c.avatar_url,
      c.avatar_versao,
      a.criada_em
    FROM public.amizades a
    JOIN public.contas c
      ON c.id = CASE WHEN a.conta_menor = p_conta THEN a.conta_maior ELSE a.conta_menor END
    WHERE a.ativa
      AND a.status = 'pendente'
      AND a.solicitante_id = p_conta
  ) e;

  SELECT coalesce(
    jsonb_agg(to_jsonb(cv) ORDER BY cv.criado_em DESC),
    '[]'::jsonb
  ) INTO v_convites
  FROM (
    SELECT
      cs.id AS convite_id,
      p.id AS partida_id,
      coalesce(nullif(trim(p.nome), ''), 'Sala ' || p.codigo) AS partida_nome,
      p.modo AS partida_modo,
      EXISTS(SELECT 1 FROM public.partidas_senhas ps WHERE ps.partida_id = p.id) AS tem_senha,
      r.id AS remetente_id,
      r.nome AS remetente_nome,
      r.avatar_url AS remetente_avatar_url,
      r.avatar_versao AS remetente_avatar_versao,
      cs.criado_em
    FROM public.convites_sala cs
    JOIN public.partidas p ON p.id = cs.partida_id
    JOIN public.contas r ON r.id = cs.remetente_id
    WHERE cs.destinatario_id = p_conta
      AND cs.status = 'pendente'
      AND cs.expira_em > now()
      AND NOT p.encerrada
      AND NOT p.dev
  ) cv;

  RETURN jsonb_build_object(
    'convidado', false,
    'amigos', v_amigos,
    'pedidos_recebidos', v_recebidos,
    'pedidos_enviados', v_enviados,
    'convites_sala', v_convites
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.listar_amigos_e_pedidos(uuid, uuid) TO anon, authenticated;

-- 12. RPC: enviar_convite_sala
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

GRANT EXECUTE ON FUNCTION public.enviar_convite_sala(uuid, uuid, uuid, uuid) TO anon, authenticated;

-- 13. RPC: aceitar_convite_sala
CREATE OR REPLACE FUNCTION public.aceitar_convite_sala(
  p_conta uuid,
  p_token uuid,
  p_convite_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_convite public.convites_sala;
  v_partida public.partidas;
  v_ent jsonb;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  SELECT * INTO v_convite
  FROM public.convites_sala
  WHERE id = p_convite_id
    AND destinatario_id = p_conta
    AND status = 'pendente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado ou já utilizado.';
  END IF;

  IF v_convite.expira_em <= now() THEN
    UPDATE public.convites_sala SET status = 'expirado' WHERE id = p_convite_id;
    RAISE EXCEPTION 'Este convite expirou.';
  END IF;

  SELECT * INTO v_partida
  FROM public.partidas
  WHERE id = v_convite.partida_id AND NOT encerrada AND NOT dev;

  IF NOT FOUND THEN
    UPDATE public.convites_sala SET status = 'expirado' WHERE id = p_convite_id;
    RAISE EXCEPTION 'Essa sala já foi encerrada.';
  END IF;

  UPDATE public.convites_sala
  SET status = 'aceito'
  WHERE id = p_convite_id;

  v_ent := public._entrar_sala_interno(p_conta, p_token, v_convite.partida_id);

  RETURN v_ent || jsonb_build_object(
    'partida_id', v_partida.id,
    'modo', v_partida.modo,
    'nome', coalesce(nullif(trim(v_partida.nome), ''), 'Sala ' || v_partida.codigo)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.aceitar_convite_sala(uuid, uuid, uuid) TO anon, authenticated;

-- 14. RPC: recusar_convite_sala
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
  SET status = 'recusado'
  WHERE id = p_convite_id
    AND destinatario_id = p_conta
    AND status = 'pendente';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recusar_convite_sala(uuid, uuid, uuid) TO anon, authenticated;
