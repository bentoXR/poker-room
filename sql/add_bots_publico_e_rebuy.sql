-- Bots híbridos em salas públicas, Jogar Agora (matchmaking / solo) e Rebuy + Espectar em R$

-- 1. Colunas novas e índice parcial para matchmaking
ALTER TABLE public.partidas
  ADD COLUMN IF NOT EXISTS com_bots boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS solo_bots boolean NOT NULL DEFAULT false;

ALTER TABLE public.jogadores
  ADD COLUMN IF NOT EXISTS espectando boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_partidas_online_abertas
  ON public.partidas (ultima_mao_em DESC)
  WHERE modo = 'online' AND NOT encerrada AND NOT dev AND NOT solo_bots;

-- 2. Helper interno: adiciona 1 bot com nome natural e nível aleatório (ou informado)
CREATE OR REPLACE FUNCTION public.adicionar_bot_sala(
  p_partida uuid,
  p_nivel text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p partidas;
  v_nomes constant text[] := array[
    'Kiro_99', 'xX_Nando', 'LéoShark', 'Biel_BR', 'Majuu', 'Tico77', 'Rafa_AK', 'DuduAllIn',
    'ViniK9', 'Gabs_07', 'PatoLoko', 'ZéBlefe', 'Caio_SP', 'Lari_23', 'Gui_River', 'Niko.gg',
    'MatheusX', 'Fefê_', 'Brabo_01', 'Kauan_RJ', 'Juju_x', 'TutuPoker', 'Digo_88', 'Luanzera',
    'Mila_98', 'Rique_S', 'Peu_10', 'Cacá_BR', 'Sandro_K', 'Yuri_Flop', 'Danilo_7', 'Bia_Star',
    'Vitão_MG', 'Lipe_04', 'Tati_gg', 'Renan_AA', 'Chico_X', 'Guto_92', 'Isa_Cards', 'Breno_V'
  ];
  v_niveis constant text[] := array['facil', 'medio', 'dificil'];
  v_nivel text;
  v_nome text;
  v_cand text;
  v_ocupados int;
  v_ordem int;
  v_bot_id uuid;
  v_idx int;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida;
  IF NOT FOUND OR v_p.encerrada THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_ocupados
  FROM public.jogadores
  WHERE partida_id = p_partida AND NOT espectando;

  IF v_ocupados >= 9 THEN
    RETURN NULL;
  END IF;

  v_nivel := lower(coalesce(nullif(trim(p_nivel), ''), v_niveis[1 + floor(random() * 3)::int]));
  IF v_nivel NOT IN ('facil', 'medio', 'dificil') THEN
    v_nivel := 'medio';
  END IF;

  -- Escolhe um nome ainda não usado na mesa (ordem aleatória)
  FOR v_cand IN
    SELECT n FROM unnest(v_nomes) AS n ORDER BY random()
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.jogadores
      WHERE partida_id = p_partida AND lower(nome) = lower(v_cand)
    ) THEN
      v_nome := v_cand;
      EXIT;
    END IF;
  END LOOP;

  IF v_nome IS NULL THEN
    v_idx := 1 + floor(random() * array_length(v_nomes, 1))::int;
    v_nome := v_nomes[v_idx] || ' ' || (10 + floor(random() * 89)::int);
  END IF;

  SELECT coalesce(max(ordem), 0) + 1 INTO v_ordem
  FROM public.jogadores WHERE partida_id = p_partida;

  INSERT INTO public.jogadores (
    partida_id, nome, saldo, total_comprado, criador, ordem,
    desistiu, esperando, eh_bot, bot_nivel
  )
  VALUES (
    p_partida, v_nome, v_p.saldo_inicial, v_p.saldo_inicial, false, v_ordem,
    v_p.iniciada, v_p.iniciada, true, v_nivel
  )
  RETURNING id INTO v_bot_id;

  INSERT INTO public.segredos (jogador_id) VALUES (v_bot_id);

  PERFORM public.registrar(p_partida, v_nome || ' entrou na mesa');
  RETURN v_bot_id;
END;
$function$;

-- 3. Helper interno: remove 1 bot para abrir vaga para um jogador humano
CREATE OR REPLACE FUNCTION public.liberar_vaga_bot(p_partida uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p partidas;
  v_bot jogadores;
  v_seg uuid;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_bot
  FROM public.jogadores
  WHERE partida_id = p_partida AND eh_bot = true
  ORDER BY
    (saldo <= 0) DESC,
    desistiu DESC,
    (id IS DISTINCT FROM v_p.vez_jogador_id) DESC,
    saldo ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Se o bot estiver com a vez na mão atual, desiste/paga blind antes de sair para não travar a vez
  IF v_p.iniciada AND NOT v_p.aguardando_proxima_mao AND v_p.vez_jogador_id = v_bot.id THEN
    SELECT segredo INTO v_seg FROM public.segredos WHERE jogador_id = v_bot.id;
    IF v_seg IS NOT NULL THEN
      IF v_p.fase_blind > 0 THEN
        PERFORM public.pagar_blind(v_bot.id, v_seg);
      ELSE
        PERFORM public.jogar(v_bot.id, v_seg, 'desistir', 0);
      END IF;
    END IF;
  END IF;

  PERFORM public.tirar_jogador_da_partida(p_partida, v_bot.id);
  PERFORM public.registrar(p_partida, v_bot.nome || ' saiu da mesa');
  RETURN true;
END;
$function$;

-- 4. Helper interno: gerencia entrada/saída dinâmica de bots híbridos
CREATE OR REPLACE FUNCTION public.gerenciar_bots_sala(p_partida uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p partidas;
  v_bot record;
  v_ocupados int;
  v_bots int;
  v_humanos int;
  v_alvo int;
  v_i int;
  v_sair_id uuid;
  v_sair_nome text;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida;
  IF NOT FOUND
     OR v_p.modo <> 'online'
     OR v_p.encerrada
     OR (NOT v_p.com_bots AND NOT v_p.solo_bots)
     OR (v_p.iniciada AND NOT v_p.aguardando_proxima_mao) THEN
    RETURN;
  END IF;

  -- Remove bots que ficaram sem fichas
  FOR v_bot IN
    SELECT id, nome FROM public.jogadores
    WHERE partida_id = p_partida AND eh_bot = true AND saldo <= 0
  LOOP
    PERFORM public.tirar_jogador_da_partida(p_partida, v_bot.id);
    PERFORM public.registrar(p_partida, v_bot.nome || ' saiu da mesa');
  END LOOP;

  SELECT
    count(*) filter (where NOT espectando),
    count(*) filter (where eh_bot),
    count(*) filter (where NOT eh_bot AND NOT espectando)
  INTO v_ocupados, v_bots, v_humanos
  FROM public.jogadores
  WHERE partida_id = p_partida;

  -- Primeira população ao criar a sala: 3 a 6 bots (respeitando teto de 8 ocupados)
  IF NOT v_p.iniciada AND v_p.mao = 1 AND v_bots = 0 THEN
    v_alvo := least(8 - v_humanos, 3 + floor(random() * 4)::int);
    v_alvo := greatest(3, least(6, v_alvo));
    FOR v_i IN 1..v_alvo LOOP
      EXIT WHEN (v_humanos + v_i - 1) >= 8;
      PERFORM public.adicionar_bot_sala(p_partida, NULL);
    END LOOP;
  ELSE
    -- Entre mãos: garante pelo menos 3 bots quando há vaga (< 8 ocupados)
    IF v_bots < 3 AND v_ocupados < 8 THEN
      v_alvo := least(3 - v_bots, 8 - v_ocupados);
      FOR v_i IN 1..v_alvo LOOP
        PERFORM public.adicionar_bot_sala(p_partida, NULL);
      END LOOP;
    ELSIF v_ocupados < 8 AND random() < 0.35 THEN
      PERFORM public.adicionar_bot_sala(p_partida, NULL);
    ELSIF v_bots >= 5 AND v_ocupados >= 6 AND random() < 0.15 THEN
      SELECT id, nome INTO v_sair_id, v_sair_nome
      FROM public.jogadores
      WHERE partida_id = p_partida AND eh_bot = true AND saldo > 0
      ORDER BY random()
      LIMIT 1;
      IF v_sair_id IS NOT NULL THEN
        PERFORM public.tirar_jogador_da_partida(p_partida, v_sair_id);
        PERFORM public.registrar(p_partida, v_sair_nome || ' saiu da mesa');
      END IF;
    END IF;
  END IF;

  UPDATE public.partidas SET versao = versao WHERE id = p_partida;
END;
$function$;

-- 5. Atualiza entrar_partida para respeitar espectando e liberar vaga de bot quando cheia
CREATE OR REPLACE FUNCTION public.entrar_partida(p_partida_id uuid, p_nome text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_nome    text := left(trim(coalesce(p_nome, '')), 20);
  v_partida partidas;
  v_jogador jogadores;
  v_segredo uuid;
  v_ordem   int;
  v_ocupados int;
begin
  if v_nome = '' then
    raise exception 'Digite seu nome.';
  end if;

  select * into v_partida from partidas where id = p_partida_id;
  if not found then
    raise exception 'Partida não encontrada.';
  end if;

  select count(*) into v_ocupados
  from jogadores
  where partida_id = p_partida_id and not espectando;

  if v_ocupados >= 9 then
    if v_partida.com_bots and public.liberar_vaga_bot(p_partida_id) then
      null;
    else
      raise exception 'Mesa cheia (máximo 9 jogadores).';
    end if;
  end if;

  select coalesce(max(ordem), 0) + 1 into v_ordem
  from jogadores where partida_id = p_partida_id;

  insert into jogadores (partida_id, nome, saldo, total_comprado, criador, ordem, desistiu)
  values (p_partida_id, v_nome, v_partida.saldo_inicial, v_partida.saldo_inicial, false, v_ordem, v_partida.iniciada)
  returning * into v_jogador;

  insert into segredos (jogador_id) values (v_jogador.id)
  returning segredo into v_segredo;

  perform registrar(
    p_partida_id,
    v_nome || ' entrou na partida (Jogador ' || v_ordem || ')'
      || case when v_partida.iniciada then ' e joga a partir da próxima mão' else '' end
  );

  update partidas set versao = versao where id = p_partida_id;

  return json_build_object('jogador_id', v_jogador.id, 'segredo', v_segredo);
end;
$function$;

-- 6. Sobrecarga de criar_sala_online com p_com_bots (sem DROP FUNCTION, sem ambiguidade)
CREATE OR REPLACE FUNCTION public.criar_sala_online(
  p_conta uuid,
  p_token uuid,
  p_saldo integer,
  p_small integer,
  p_big integer,
  p_tempo_turno integer,
  p_subir_blinds_min integer,
  p_nome text,
  p_com_bots boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_res   jsonb;
  v_pid   uuid;
  v_tempo int := case when coalesce(p_tempo_turno, 30) <= 0 then 0
                      else greatest(15, least(120, coalesce(p_tempo_turno, 30))) end;
  v_subir int := greatest(0, least(120, coalesce(p_subir_blinds_min, 0)));
  v_bots  boolean := coalesce(p_com_bots, false);
begin
  v_res := public.criar_sala(p_conta, p_token, p_saldo, p_small, p_big, p_nome);
  v_pid := (v_res->>'partida_id')::uuid;

  update partidas
  set modo = 'online',
      tempo_turno = v_tempo,
      subir_blinds_min = v_subir,
      small_blind_inicial = p_small,
      big_blind_inicial = p_big,
      com_bots = v_bots
  where id = v_pid;

  if v_bots then
    perform public.gerenciar_bots_sala(v_pid);
  end if;

  return v_res || jsonb_build_object('modo', 'online', 'com_bots', v_bots);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_sala_online(uuid, uuid, integer, integer, integer, integer, integer, text, boolean) TO anon, authenticated;

-- 7. Atualiza sair_da_sala: encerra sala online quando o último humano sair
CREATE OR REPLACE FUNCTION public.sair_da_sala(p_jogador uuid, p_segredo uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_j       jogadores;
  v_p       partidas;
  v_humanos int;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  select * into v_p from partidas where id = v_j.partida_id for update;

  if v_p.modo = 'online' then
    if v_p.iniciada and not v_p.aguardando_proxima_mao and not v_j.desistiu and v_j.saldo > 0 then
      raise exception 'Aguarde o fim desta mão (ou desista) para sair da mesa.';
    end if;
  else
    if v_j.criador then
      raise exception 'O criador não pode sair da sala. Só pode encerrá-la.';
    end if;
    if v_p.iniciada and not v_p.aguardando_proxima_mao then
      raise exception 'Você só pode sair entre as mãos.';
    end if;
  end if;

  if v_j.conta_id is not null then
    insert into fichas_guardadas (partida_id, conta_id, saldo)
    values (v_p.id, v_j.conta_id, v_j.saldo)
    on conflict (partida_id, conta_id) do update set saldo = excluded.saldo;
  end if;

  perform registrar(v_p.id, v_j.nome || ' saiu da sala (fichas guardadas: ' || v_j.saldo || ')');
  perform tirar_jogador_da_partida(v_p.id, v_j.id);

  if v_p.modo = 'online' then
    select count(*) into v_humanos from jogadores where partida_id = v_p.id and not eh_bot;
    if v_humanos = 0 or v_p.solo_bots then
      update partidas set encerrada = true where id = v_p.id;
    else
      update partidas set versao = versao where id = v_p.id;
    end if;
  else
    update partidas set versao = versao where id = v_p.id;
  end if;

  return estado_mesa(v_p.id);
end;
$function$;

-- 8. Atualiza listar_salas_base e listar_salas (contagem de humanos + flag com_bots + oculta solo_bots)
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

CREATE OR REPLACE FUNCTION public.listar_salas(p_conta uuid, p_token uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(e.valor order by e.pos), '[]'::jsonb)
  from jsonb_array_elements(to_jsonb(public.listar_salas_base(p_conta, p_token)))
       with ordinality as e(valor, pos)
  where not exists (
    select 1 from public.partidas p
    where p.id::text = e.valor->>'id' and (p.dev or p.solo_bots)
  )
$function$;

-- 9. Atualiza bot_confirmar_online para gerenciar bots entre mãos e ignorar espectadores
CREATE OR REPLACE FUNCTION public.bot_confirmar_online(p_partida uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p partidas;
  v_bots_pendentes int;
  v_humanos_pendentes int;
  v_elegiveis int;
  v_confirmados int;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida FOR UPDATE;

  IF NOT FOUND
     OR v_p.modo <> 'online'
     OR v_p.encerrada
     OR v_p.pausada
     OR (v_p.iniciada AND NOT v_p.aguardando_proxima_mao) THEN
    RETURN public.estado_mesa(p_partida);
  END IF;

  SELECT count(*) INTO v_humanos_pendentes
  FROM public.jogadores
  WHERE partida_id = v_p.id
    AND eh_bot = false
    AND NOT espectando
    AND saldo > 0
    AND NOT ausente
    AND NOT confirmado;

  IF v_humanos_pendentes > 0 AND v_p.proxima_mao_em IS NULL THEN
    RETURN public.estado_mesa(p_partida);
  END IF;

  IF v_p.com_bots OR v_p.solo_bots THEN
    PERFORM public.gerenciar_bots_sala(v_p.id);
  END IF;

  SELECT count(*) INTO v_bots_pendentes
  FROM public.jogadores
  WHERE partida_id = v_p.id
    AND eh_bot = true
    AND saldo > 0
    AND NOT ausente
    AND NOT confirmado;

  IF v_bots_pendentes > 0 THEN
    UPDATE public.jogadores
    SET confirmado = true,
        ausente = false
    WHERE partida_id = v_p.id
      AND eh_bot = true
      AND saldo > 0
      AND NOT ausente
      AND NOT confirmado;
  END IF;

  SELECT count(*), count(*) filter (where confirmado)
    INTO v_elegiveis, v_confirmados
  FROM public.jogadores
  WHERE partida_id = v_p.id AND NOT espectando AND saldo > 0 AND NOT ausente;

  IF v_confirmados >= 2 AND v_confirmados = v_elegiveis THEN
    PERFORM public.iniciar_mao_online(v_p.id);
  ELSIF v_confirmados >= 2 AND v_p.proxima_mao_em IS NULL THEN
    UPDATE public.partidas SET proxima_mao_em = now() + interval '30 seconds' WHERE id = v_p.id;
  ELSE
    UPDATE public.partidas SET versao = versao WHERE id = v_p.id;
  END IF;

  RETURN public.estado_mesa(v_p.id);
END;
$function$;

-- 10. Novas RPCs: Jogar Agora (matchmaking / solo), Rebuy e Espectar
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

  -- Busca uma sala Online pública aleatória com humanos e vaga disponível
  SELECT p.id INTO v_pid
  FROM public.partidas p
  WHERE p.modo = 'online'
    AND NOT p.encerrada
    AND NOT p.dev
    AND NOT p.solo_bots
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

GRANT EXECUTE ON FUNCTION public.jogar_agora_online(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.criar_sala_solo_bots(p_conta uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res jsonb;
  v_pid uuid;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  v_res := public.criar_sala_online(
    p_conta,
    p_token,
    10000,
    50,
    100,
    30,
    0,
    'Mesa Solo',
    true
  );
  v_pid := (v_res->>'partida_id')::uuid;

  UPDATE public.partidas
  SET solo_bots = true
  WHERE id = v_pid;

  RETURN v_res || jsonb_build_object('solo_bots', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_sala_solo_bots(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rebuy_online(
  p_jogador uuid,
  p_segredo uuid,
  p_fracao text DEFAULT '1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_j jogadores;
  v_p partidas;
  v_valor int;
  v_ocupados int;
BEGIN
  v_j := public.conferir_jogador(p_jogador, p_segredo);
  SELECT * INTO v_p FROM public.partidas WHERE id = v_j.partida_id FOR UPDATE;

  IF v_p.modo <> 'online' THEN
    RAISE EXCEPTION 'Rebuy disponível apenas no modo Online.';
  END IF;
  IF coalesce(v_p.valor_real_mil, 0) <= 0 THEN
    RAISE EXCEPTION 'Rebuy disponível apenas em salas com referência em R$.';
  END IF;
  IF v_j.saldo > 0 THEN
    RAISE EXCEPTION 'Você ainda possui fichas na mesa.';
  END IF;
  IF v_p.iniciada AND NOT v_p.aguardando_proxima_mao AND NOT v_j.desistiu AND NOT v_j.espectando THEN
    RAISE EXCEPTION 'Aguarde o fim da mão atual para comprar mais fichas.';
  END IF;

  v_valor := CASE trim(coalesce(p_fracao, '1'))
    WHEN '1/2' THEN greatest(v_p.big_blind, round(v_p.saldo_inicial / 2.0)::int)
    WHEN '1/4' THEN greatest(v_p.big_blind, round(v_p.saldo_inicial / 4.0)::int)
    ELSE v_p.saldo_inicial
  END;

  IF v_j.espectando THEN
    SELECT count(*) INTO v_ocupados
    FROM public.jogadores
    WHERE partida_id = v_p.id AND NOT espectando;

    IF v_ocupados >= 9 THEN
      IF NOT (v_p.com_bots AND public.liberar_vaga_bot(v_p.id)) THEN
        RAISE EXCEPTION 'Mesa cheia no momento (9 jogadores).';
      END IF;
    END IF;
  END IF;

  UPDATE public.jogadores
  SET saldo = v_valor,
      total_comprado = coalesce(total_comprado, v_p.saldo_inicial) + v_valor,
      espectando = false,
      ausente = false,
      esperando = (v_p.iniciada AND NOT v_p.aguardando_proxima_mao),
      desistiu = (v_p.iniciada AND NOT v_p.aguardando_proxima_mao)
  WHERE id = v_j.id;

  PERFORM public.registrar(v_p.id, v_j.nome || ' comprou +' || v_valor || ' fichas');
  UPDATE public.partidas SET versao = versao WHERE id = v_p.id;

  RETURN public.estado_mesa(v_p.id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rebuy_online(uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.espectar_online(
  p_jogador uuid,
  p_segredo uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_j jogadores;
  v_p partidas;
BEGIN
  v_j := public.conferir_jogador(p_jogador, p_segredo);
  SELECT * INTO v_p FROM public.partidas WHERE id = v_j.partida_id FOR UPDATE;

  IF v_p.modo <> 'online' THEN
    RAISE EXCEPTION 'Disponível apenas no modo Online.';
  END IF;
  IF v_j.saldo > 0 THEN
    RAISE EXCEPTION 'Você ainda possui fichas na mesa.';
  END IF;
  IF v_p.iniciada AND NOT v_p.aguardando_proxima_mao AND NOT v_j.desistiu THEN
    RAISE EXCEPTION 'Aguarde o fim da mão atual para espectar.';
  END IF;

  UPDATE public.jogadores
  SET espectando = true,
      desistiu = true,
      esperando = true,
      confirmado = false,
      ausente = false
  WHERE id = v_j.id;

  PERFORM public.registrar(v_p.id, v_j.nome || ' está espectando a mesa');
  UPDATE public.partidas SET versao = versao WHERE id = v_p.id;

  RETURN public.estado_mesa(v_p.id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.espectar_online(uuid, uuid) TO anon, authenticated;
