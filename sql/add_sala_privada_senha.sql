-- Salas privadas com senha (tabela isolada com RLS, sem expor hash ao cliente)
CREATE TABLE IF NOT EXISTS public.partidas_senhas (
  partida_id uuid PRIMARY KEY REFERENCES public.partidas(id) ON DELETE CASCADE,
  senha_hash text NOT NULL
);

ALTER TABLE public.partidas_senhas ENABLE ROW LEVEL SECURITY;

-- RPC para o criador definir a senha da sala logo após criá-la
CREATE OR REPLACE FUNCTION public.definir_senha_sala(
  p_jogador uuid,
  p_segredo uuid,
  p_senha text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_j jogadores;
  v_senha text := trim(coalesce(p_senha, ''));
BEGIN
  v_j := public.conferir_jogador(p_jogador, p_segredo);
  IF NOT v_j.criador THEN
    RAISE EXCEPTION 'Só o criador pode definir a senha da sala.';
  END IF;
  IF length(v_senha) < 1 OR length(v_senha) > 32 THEN
    RAISE EXCEPTION 'A senha da sala deve ter entre 1 e 32 caracteres.';
  END IF;

  INSERT INTO public.partidas_senhas (partida_id, senha_hash)
  VALUES (v_j.partida_id, extensions.crypt(v_senha, extensions.gen_salt('bf', 8)))
  ON CONFLICT (partida_id) DO UPDATE SET senha_hash = excluded.senha_hash;

  UPDATE public.partidas SET versao = versao WHERE id = v_j.partida_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.definir_senha_sala(uuid, uuid, text) TO anon, authenticated;

-- Helper interno compartilhado entre entrar_sala e entrar_sala_senha
CREATE OR REPLACE FUNCTION public._entrar_sala_interno(
  p_conta uuid,
  p_token uuid,
  p_partida_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome     text;
  v_j        jogadores;
  v_seg      uuid;
  v_res      jsonb;
  v_guardado int;
BEGIN
  v_nome := public.conferir_conta(p_conta, p_token);

  IF NOT EXISTS (SELECT 1 FROM public.partidas WHERE id = p_partida_id AND NOT encerrada) THEN
    RAISE EXCEPTION 'Essa sala não existe mais.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('poker-sala-' || p_partida_id::text));

  SELECT * INTO v_j
  FROM public.jogadores
  WHERE partida_id = p_partida_id AND conta_id = p_conta;

  IF FOUND THEN
    SELECT s.segredo INTO v_seg FROM public.segredos s WHERE s.jogador_id = v_j.id;
    IF v_seg IS NULL THEN
      RAISE EXCEPTION 'Não consegui recuperar o seu jogador nesta sala.';
    END IF;
    RETURN jsonb_build_object(
      'jogador_id', v_j.id,
      'segredo', v_seg,
      'reconectado', true
    );
  END IF;

  v_res := public.entrar_partida(p_partida_id, v_nome)::jsonb;

  UPDATE public.jogadores
  SET conta_id = p_conta
  WHERE id = (v_res->>'jogador_id')::uuid;

  SELECT f.saldo INTO v_guardado
  FROM public.fichas_guardadas f
  WHERE f.partida_id = p_partida_id AND f.conta_id = p_conta;

  IF FOUND THEN
    UPDATE public.jogadores
    SET saldo = v_guardado
    WHERE id = (v_res->>'jogador_id')::uuid;

    DELETE FROM public.fichas_guardadas
    WHERE partida_id = p_partida_id AND conta_id = p_conta;

    PERFORM public.registrar(p_partida_id, v_nome || ' voltou com ' || v_guardado || ' fichas');
    UPDATE public.partidas SET versao = versao WHERE id = p_partida_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.partidas WHERE id = p_partida_id AND iniciada) THEN
    UPDATE public.jogadores
    SET esperando = true, desistiu = true
    WHERE id = (v_res->>'jogador_id')::uuid;

    PERFORM public.registrar(p_partida_id, v_nome || ' entrou e espera a próxima mão');
    UPDATE public.partidas SET versao = versao WHERE id = p_partida_id;
  END IF;

  RETURN v_res || jsonb_build_object('reconectado', false);
END;
$function$;

-- Atualiza entrar_sala para exigir senha caso a sala seja privada e o usuário ainda não esteja nela
CREATE OR REPLACE FUNCTION public.entrar_sala(
  p_conta uuid,
  p_token uuid,
  p_partida_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  IF EXISTS (SELECT 1 FROM public.partidas_senhas WHERE partida_id = p_partida_id)
     AND NOT EXISTS (SELECT 1 FROM public.jogadores WHERE partida_id = p_partida_id AND conta_id = p_conta) THEN
    RAISE EXCEPTION 'Esta sala é privada. Digite a senha para entrar.';
  END IF;

  RETURN public._entrar_sala_interno(p_conta, p_token, p_partida_id);
END;
$function$;

-- Nova RPC para entrar em sala privada informando a senha
CREATE OR REPLACE FUNCTION public.entrar_sala_senha(
  p_conta uuid,
  p_token uuid,
  p_partida_id uuid,
  p_senha text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_hash text;
  v_senha text := trim(coalesce(p_senha, ''));
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  IF NOT EXISTS (SELECT 1 FROM public.partidas WHERE id = p_partida_id AND NOT encerrada) THEN
    RAISE EXCEPTION 'Essa sala não existe mais.';
  END IF;

  SELECT senha_hash INTO v_hash
  FROM public.partidas_senhas
  WHERE partida_id = p_partida_id;

  IF v_hash IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.jogadores WHERE partida_id = p_partida_id AND conta_id = p_conta) THEN
    IF v_senha = '' THEN
      RAISE EXCEPTION 'Digite a senha da sala.';
    END IF;
    IF v_hash <> extensions.crypt(v_senha, v_hash) THEN
      RAISE EXCEPTION 'Senha incorreta.';
    END IF;
  END IF;

  RETURN public._entrar_sala_interno(p_conta, p_token, p_partida_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.entrar_sala_senha(uuid, uuid, uuid, text) TO anon, authenticated;

-- Atualiza listar_salas_base para expor tem_senha (boolean)
CREATE OR REPLACE FUNCTION public.listar_salas_base(p_conta uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  perform conferir_conta(p_conta, p_token);

  return (
    select coalesce(
      jsonb_agg(to_jsonb(s) order by s.sou_jogador desc, s.criada_em desc),
      '[]'::jsonb
    )
    from (
      select
        p.id,
        coalesce(p.nome, 'Sala ' || p.codigo) as nome,
        p.modo,
        p.tempo_turno,
        p.subir_blinds_min,
        p.iniciada,
        p.nivel,
        p.mao,
        p.small_blind,
        p.big_blind,
        p.criada_em,
        p.com_bots,
        p.solo_bots,
        exists (select 1 from public.partidas_senhas ps where ps.partida_id = p.id) as tem_senha,
        (select count(*) from jogadores j
         where j.partida_id = p.id and not j.eh_bot and not j.espectando) as n_jogadores,
        exists (select 1 from jogadores j
                where j.partida_id = p.id and j.conta_id = p_conta) as sou_jogador,
        exists (select 1 from jogadores j
                where j.partida_id = p.id and j.conta_id = p_conta and j.criador) as sou_criador
      from partidas p
      where not p.encerrada
        and p.ultima_mao_em > now() - interval '5 minutes'
      order by sou_jogador desc, p.criada_em desc
      limit 50
    ) s
  );
end;
$function$;

-- Garante que Jogar Agora nunca coloca alguém aleatório em sala privada com senha
CREATE OR REPLACE FUNCTION public.jogar_agora_online(p_conta uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
  v_pid uuid;
  v_res jsonb;
BEGIN
  v_nome := public.conferir_conta(p_conta, p_token);

  SELECT p.id INTO v_pid
  FROM public.partidas p
  WHERE p.modo = 'online'
    AND NOT p.encerrada
    AND NOT p.dev
    AND NOT p.solo_bots
    AND NOT EXISTS (SELECT 1 FROM public.partidas_senhas ps WHERE ps.partida_id = p.id)
    AND p.ultima_mao_em > now() - interval '5 minutes'
    AND EXISTS (
      SELECT 1 FROM public.jogadores j
      WHERE j.partida_id = p.id AND NOT j.eh_bot AND NOT j.espectando
    )
    AND (
      (SELECT count(*) FROM public.jogadores j WHERE j.partida_id = p.id AND NOT j.espectando) < 9
      OR p.com_bots
      OR EXISTS (SELECT 1 FROM public.jogadores j WHERE j.partida_id = p.id AND j.conta_id = p_conta)
    )
    AND (
      SELECT count(*) FROM public.jogadores j
      WHERE j.partida_id = p.id AND NOT j.eh_bot AND NOT j.espectando
    ) < 9
  ORDER BY random()
  LIMIT 1;

  IF v_pid IS NOT NULL THEN
    v_res := public.entrar_sala(p_conta, p_token, v_pid);
    RETURN v_res || jsonb_build_object('partida_id', v_pid, 'modo', 'online', 'criada', false);
  END IF;

  v_res := public.criar_sala_online(
    p_conta,
    p_token,
    10000,
    50,
    100,
    30,
    10,
    'Mesa de ' || v_nome,
    true
  );
  RETURN v_res || jsonb_build_object('criada', true);
END;
$function$;
