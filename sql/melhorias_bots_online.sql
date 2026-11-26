-- Melhorias no modo contra bots:
-- 1) Coluna aguardando_vaga_bot para entrada em mesa lotada com bots durante mão ativa
-- 2) Remoção da saída aleatória de bots com fichas (bots só saem ao zerar ou para dar vaga a humano)
-- 3) Arredondamento organizado das apostas dos bots (múltiplos limpos de SB/BB/5BB/passo)
-- 4) Promoção automática ao fim da mão de quem aguarda vaga de bot

ALTER TABLE public.jogadores
  ADD COLUMN IF NOT EXISTS aguardando_vaga_bot boolean NOT NULL DEFAULT false;

-- Promove jogadores que entraram espectando aguardando vaga de bot ao final da mão
CREATE OR REPLACE FUNCTION public.promover_espera_vaga_bot(p_partida uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p partidas;
  v_j record;
  v_ocupados int;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida;
  IF NOT FOUND OR v_p.encerrada OR (v_p.iniciada AND NOT v_p.aguardando_proxima_mao) THEN
    RETURN;
  END IF;

  FOR v_j IN
    SELECT id, nome
    FROM public.jogadores
    WHERE partida_id = p_partida
      AND aguardando_vaga_bot = true
      AND NOT eh_bot
    ORDER BY ordem ASC
  LOOP
    SELECT count(*) INTO v_ocupados
    FROM public.jogadores
    WHERE partida_id = p_partida AND NOT espectando;

    IF v_ocupados >= 9 THEN
      IF NOT public.liberar_vaga_bot(p_partida) THEN
        EXIT;
      END IF;
    END IF;

    UPDATE public.jogadores
    SET espectando = false,
        aguardando_vaga_bot = false,
        esperando = false,
        desistiu = false,
        confirmado = false,
        ausente = false
    WHERE id = v_j.id;

    PERFORM public.registrar(p_partida, v_j.nome || ' entrou na mesa');
  END LOOP;
END;
$function$;

-- Atualiza gerenciar_bots_sala: promove quem aguarda vaga e remove saída aleatória de bots com fichas
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

  -- Promove humanos que estavam espectando aguardando vaga de bot
  PERFORM public.promover_espera_vaga_bot(p_partida);

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
    END IF;
  END IF;

  UPDATE public.partidas SET versao = versao WHERE id = p_partida;
END;
$function$;

-- Atualiza entrar_partida: se mesa cheia com bots durante mão ativa, entra espectando aguardando o fim da mão
CREATE OR REPLACE FUNCTION public.entrar_partida(p_partida_id uuid, p_nome text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_nome       text := left(trim(coalesce(p_nome, '')), 20);
  v_partida    partidas;
  v_jogador    jogadores;
  v_segredo    uuid;
  v_ordem      int;
  v_ocupados   int;
  v_tem_bot    boolean;
  v_espera_bot boolean := false;
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

  select exists (
    select 1 from jogadores
    where partida_id = p_partida_id and eh_bot = true
  ) into v_tem_bot;

  if v_ocupados >= 9 then
    if v_tem_bot then
      if v_partida.iniciada and not v_partida.aguardando_proxima_mao then
        v_espera_bot := true;
      elsif not public.liberar_vaga_bot(p_partida_id) then
        raise exception 'Mesa cheia (máximo 9 jogadores).';
      end if;
    else
      raise exception 'Mesa cheia (máximo 9 jogadores).';
    end if;
  end if;

  select coalesce(max(ordem), 0) + 1 into v_ordem
  from jogadores where partida_id = p_partida_id;

  insert into jogadores (
    partida_id, nome, saldo, total_comprado, criador, ordem,
    esperando, desistiu, espectando, aguardando_vaga_bot
  )
  values (
    p_partida_id, v_nome, v_partida.saldo_inicial, v_partida.saldo_inicial, false, v_ordem,
    (v_partida.iniciada or v_espera_bot),
    (v_partida.iniciada or v_espera_bot),
    v_espera_bot,
    v_espera_bot
  )
  returning * into v_jogador;

  insert into segredos (jogador_id) values (v_jogador.id)
  returning segredo into v_segredo;

  perform registrar(
    p_partida_id,
    case
      when v_espera_bot then v_nome || ' entrou espectando (aguardando vaga ao fim da mão)'
      else v_nome || ' entrou na partida (Jogador ' || v_ordem || ')'
        || case when v_partida.iniciada then ' e joga a partir da próxima mão' else '' end
    end
  );

  update partidas set versao = versao where id = p_partida_id;

  return json_build_object('jogador_id', v_jogador.id, 'segredo', v_segredo);
end;
$function$;

-- Atualiza premiar_unico: preserva desistiu = espectando e promove quem aguarda vaga de bot
CREATE OR REPLACE FUNCTION public.premiar_unico(p_partida uuid, p_ganhador uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_p       partidas;
  v_nome    text;
  v_ativos  int;
  v_campeao text;
begin
  select * into v_p from partidas where id = p_partida;
  select nome into v_nome from jogadores where id = p_ganhador;

  update jogadores set saldo = saldo + v_p.pote where id = p_ganhador;

  perform registrar(p_partida, v_nome || ' ganhou ' || v_p.pote || ' (todos desistiram)', 'pote');

  update jogadores
  set apostou = 0, desistiu = espectando, falou = false, confirmado = false
  where partida_id = p_partida;

  select count(*) into v_ativos from jogadores where partida_id = p_partida and saldo > 0;

  if v_p.modo = 'online' then
    if v_ativos >= 2 then
      update partidas
      set pote = 0,
          mao = v_p.mao + 1,
          aguardando_proxima_mao = true,
          proxima_mao_em = now() + interval '30 seconds',
          vez_jogador_id = null,
          fase = 0,
          aguardando_cartas = false,
          aposta_atual = 0,
          fase_blind = 0,
          ultimo_resultado = jsonb_build_object(
            'mao', v_p.mao,
            'tipo', 'desistencia',
            'vencedor_id', p_ganhador,
            'vencedor_nome', v_nome,
            'valor', v_p.pote
          )
      where id = p_partida;
      perform public.promover_espera_vaga_bot(p_partida);
    else
      select nome into v_campeao from jogadores where partida_id = p_partida and saldo > 0 limit 1;
      perform registrar(p_partida, 'Fim da partida! Campeão: ' || coalesce(v_campeao, v_nome));
      update partidas
      set pote = 0,
          mao = v_p.mao + 1,
          aguardando_proxima_mao = true,
          proxima_mao_em = null,
          vez_jogador_id = null,
          fase = 0,
          aguardando_cartas = false,
          aposta_atual = 0,
          fase_blind = 0,
          ultimo_resultado = jsonb_build_object(
            'mao', v_p.mao,
            'tipo', 'desistencia',
            'vencedor_id', p_ganhador,
            'vencedor_nome', v_nome,
            'valor', v_p.pote,
            'campeao', coalesce(v_campeao, v_nome)
          )
      where id = p_partida;
    end if;
  else
    if v_ativos >= 2 then
      perform registrar(p_partida, 'Mão ' || v_p.mao || ' terminou. Aguardando o criador iniciar a próxima.');
    else
      perform registrar(p_partida, 'Fim da partida: só resta um jogador com fichas');
    end if;

    update partidas
    set pote = 0,
        mao = v_p.mao + 1,
        aguardando_proxima_mao = true,
        vez_jogador_id = null,
        fase = 0,
        aguardando_cartas = false,
        aposta_atual = 0,
        fase_blind = 0
    where id = p_partida;
  end if;
end;
$function$;

-- Atualiza resolver_showdown_online: preserva desistiu = espectando e promove quem aguarda vaga de bot
CREATE OR REPLACE FUNCTION public.resolver_showdown_online(p_partida_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_p           partidas;
  v_board       text[];
  v_j           record;
  v_eval        jsonb;
  v_evals       jsonb := '[]'::jsonb;
  v_niveis      int[];
  v_nivel       int;
  v_ant         int := 0;
  v_pote_val    int;
  v_pote_idx    int := 0;
  v_n_potes     int := 0;
  v_potes_arr   jsonb := '[]'::jsonb;
  v_pote_nome   text;
  v_max_score   bigint;
  v_venc_ids    uuid[];
  v_passo       int;
  v_unid        int;
  v_unids       int;
  v_base        int;
  v_resto       int;
  v_ord_dealer  int;
  v_n_jogs      int;
  v_ganho       int;
  v_i           int;
  v_vid         uuid;
  v_vnome       text;
  v_vmao        text;
  v_vmelhores   jsonb;
  v_venc_json   jsonb;
  v_res_potes   jsonb := '[]'::jsonb;
  v_campeao     text;
  v_ativos_cnt  int;
  v_sobra_morta int;
  v_pote_item   jsonb;
  v_ultimo_idx  int;
begin
  select * into v_p from partidas where id = p_partida_id;
  select board_oculto into v_board from baralhos_online where partida_id = p_partida_id;
  if v_board is null or array_length(v_board, 1) < 5 then
    raise exception 'Baralho da mão não encontrado.';
  end if;

  for v_j in
    select j.id, j.nome, j.ordem, j.total_mao, j.desistiu, cp.c1, cp.c2
    from jogadores j
    left join cartas_privadas cp on cp.jogador_id = j.id and cp.mao = v_p.mao
    where j.partida_id = p_partida_id and j.total_mao > 0
    order by j.ordem
  loop
    if not v_j.desistiu and v_j.c1 is not null and v_j.c2 is not null then
      v_eval := avaliar_mao_online(array[v_j.c1, v_j.c2] || v_board[1:5]);
      update jogadores
      set cartas_visiveis = array[v_j.c1, v_j.c2],
          mao_nome = v_eval->>'nome'
      where id = v_j.id;

      v_evals := v_evals || jsonb_build_object(
        'jogador_id', v_j.id,
        'nome', v_j.nome,
        'ordem', v_j.ordem,
        'total_mao', v_j.total_mao,
        'desistiu', false,
        'score', (v_eval->>'score')::bigint,
        'mao_nome', v_eval->>'nome',
        'melhores', v_eval->'melhores'
      );
    else
      v_evals := v_evals || jsonb_build_object(
        'jogador_id', v_j.id,
        'nome', v_j.nome,
        'ordem', v_j.ordem,
        'total_mao', v_j.total_mao,
        'desistiu', true,
        'score', 0,
        'mao_nome', null,
        'melhores', '[]'::jsonb
      );
    end if;
  end loop;

  select array_agg(distinct (e->>'total_mao')::int order by (e->>'total_mao')::int)
    into v_niveis
  from jsonb_array_elements(v_evals) e
  where (e->>'desistiu')::boolean = false and (e->>'total_mao')::int > 0;

  if v_niveis is not null then
    foreach v_nivel in array v_niveis loop
      select coalesce(sum(greatest(0, least((e->>'total_mao')::int, v_nivel) - v_ant)), 0)
        into v_pote_val
      from jsonb_array_elements(v_evals) e;

      if v_pote_val > 0 then
        v_potes_arr := v_potes_arr || jsonb_build_object('nivel', v_nivel, 'valor', v_pote_val);
      end if;
      v_ant := v_nivel;
    end loop;

    select coalesce(sum(greatest(0, (e->>'total_mao')::int - v_ant)), 0)
      into v_sobra_morta
    from jsonb_array_elements(v_evals) e;

    v_n_potes := jsonb_array_length(v_potes_arr);
    if v_sobra_morta > 0 and v_n_potes > 0 then
      v_ultimo_idx := v_n_potes - 1;
      v_potes_arr := jsonb_set(
        v_potes_arr,
        array[v_ultimo_idx::text, 'valor'],
        to_jsonb(((v_potes_arr->v_ultimo_idx)->>'valor')::int + v_sobra_morta)
      );
    end if;
  end if;

  v_n_potes := jsonb_array_length(v_potes_arr);
  v_passo := passo_aposta(p_partida_id);
  select ordem into v_ord_dealer from jogadores where id = v_p.dealer_jogador_id;
  select count(*) into v_n_jogs from jogadores where partida_id = p_partida_id;
  v_ord_dealer := coalesce(v_ord_dealer, v_n_jogs);

  for v_pote_idx in 0..(greatest(v_n_potes - 1, -1)) loop
    v_pote_item := v_potes_arr->v_pote_idx;
    v_nivel := (v_pote_item->>'nivel')::int;
    v_pote_val := (v_pote_item->>'valor')::int;

    v_pote_nome := case
      when v_n_potes = 1 then 'Pote'
      when v_pote_idx = 0 then 'Pote principal'
      when v_n_potes = 2 then 'Pote lateral'
      else 'Pote lateral ' || v_pote_idx
    end;

    select max((e->>'score')::bigint) into v_max_score
    from jsonb_array_elements(v_evals) e
    where (e->>'desistiu')::boolean = false and (e->>'total_mao')::int >= v_nivel;

    select array_agg(
      (e->>'jogador_id')::uuid
      order by (((e->>'ordem')::int - v_ord_dealer - 1 + greatest(v_n_jogs, 1) * 10) % greatest(v_n_jogs, 1))
    )
      into v_venc_ids
    from jsonb_array_elements(v_evals) e
    where (e->>'desistiu')::boolean = false
      and (e->>'total_mao')::int >= v_nivel
      and (e->>'score')::bigint = v_max_score;

    v_unid := case when v_passo > 1 and (v_pote_val % v_passo) = 0 then v_passo else 1 end;
    v_unids := v_pote_val / v_unid;
    v_base := (v_unids / array_length(v_venc_ids, 1)) * v_unid;
    v_resto := v_unids % array_length(v_venc_ids, 1);

    v_venc_json := '[]'::jsonb;
    for v_i in 1..array_length(v_venc_ids, 1) loop
      v_vid := v_venc_ids[v_i];
      v_ganho := v_base + case when v_i <= v_resto then v_unid else 0 end;
      update jogadores set saldo = saldo + v_ganho where id = v_vid;

      select e->>'nome', e->>'mao_nome', e->'melhores'
        into v_vnome, v_vmao, v_vmelhores
      from jsonb_array_elements(v_evals) e
      where (e->>'jogador_id')::uuid = v_vid
      limit 1;

      perform registrar(
        p_partida_id,
        v_vnome || ' ganhou ' || v_ganho || ' (' || v_pote_nome
          || case when array_length(v_venc_ids, 1) > 1 then ' · empate' else '' end
          || ' · ' || coalesce(v_vmao, '') || ')',
        'pote'
      );

      v_venc_json := v_venc_json || jsonb_build_object(
        'id', v_vid,
        'nome', v_vnome,
        'valor', v_ganho,
        'mao_nome', v_vmao,
        'melhores', v_vmelhores
      );
    end loop;

    v_res_potes := v_res_potes || jsonb_build_object(
      'nome', v_pote_nome,
      'valor', v_pote_val,
      'vencedores', v_venc_json
    );
  end loop;

  update jogadores
  set apostou = 0, desistiu = espectando, falou = false, confirmado = false
  where partida_id = p_partida_id;

  select count(*) into v_ativos_cnt
  from jogadores where partida_id = p_partida_id and saldo > 0;

  if v_ativos_cnt >= 2 then
    update partidas
    set board = v_board[1:5],
        pote = 0,
        mao = v_p.mao + 1,
        aguardando_proxima_mao = true,
        proxima_mao_em = now() + interval '30 seconds',
        vez_jogador_id = null,
        fase = 4,
        aguardando_cartas = false,
        aposta_atual = 0,
        fase_blind = 0,
        agiu = false,
        ultimo_resultado = jsonb_build_object(
          'mao', v_p.mao,
          'tipo', 'showdown',
          'potes', v_res_potes
        )
    where id = p_partida_id;
    perform public.promover_espera_vaga_bot(p_partida_id);
  else
    select nome into v_campeao from jogadores where partida_id = p_partida_id and saldo > 0 limit 1;
    perform registrar(p_partida_id, 'Fim da partida! Campeão: ' || coalesce(v_campeao, '—'));

    update partidas
    set board = v_board[1:5],
        pote = 0,
        mao = v_p.mao + 1,
        aguardando_proxima_mao = true,
        proxima_mao_em = null,
        vez_jogador_id = null,
        fase = 4,
        aguardando_cartas = false,
        aposta_atual = 0,
        fase_blind = 0,
        agiu = false,
        ultimo_resultado = jsonb_build_object(
          'mao', v_p.mao,
          'tipo', 'showdown',
          'campeao', v_campeao,
          'potes', v_res_potes
        )
    where id = p_partida_id;
  end if;
end;
$function$;

-- Atualiza bot_agir_online: arredondamento limpo das apostas para múltiplos de SB/BB/5BB/passo
CREATE OR REPLACE FUNCTION public.bot_agir_online(p_partida uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p partidas;
  v_bot jogadores;
  v_segredo uuid;
  v_c1 text;
  v_c2 text;
  v_falta int;
  v_pote int;
  v_bb int;
  v_sb int;
  v_passo int;
  v_outros_fichas int;
  v_ativos int;
  v_pode_aumentar boolean;
  v_min_aposta int;
  v_pot_odds numeric;
  v_spr numeric;
  v_pos_tardia boolean := false;
  v_ord_dealer int;
  v_total_pos int;
  v_dist_dealer int;
  v_forca numeric := 0.30;
  v_eff numeric;
  v_rng numeric := random();
  v_nivel text;
  v_board_len int;
  v_av jsonb;
  v_score bigint;
  v_cat int;
  v_r1 int;
  v_r_c1 int;
  v_r_c2 int;
  v_par_privado boolean;
  v_max_board int := 0;
  v_b text;
  v_br int;
  v_draws jsonb;
  v_flush_draw boolean := false;
  v_oesd boolean := false;
  v_gutshot boolean := false;
  v_acao text := 'check';
  v_valor int := 0;
  v_alvo int;
  v_total_alvo int;
  v_unit int;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida FOR UPDATE;

  IF NOT FOUND
     OR v_p.modo <> 'online'
     OR v_p.encerrada
     OR v_p.pausada
     OR NOT v_p.iniciada
     OR v_p.aguardando_proxima_mao
     OR v_p.aguardando_cartas
     OR v_p.fase >= 4
     OR v_p.vez_jogador_id IS NULL THEN
    RETURN public.estado_mesa(p_partida);
  END IF;

  SELECT * INTO v_bot FROM public.jogadores WHERE id = v_p.vez_jogador_id;
  IF NOT FOUND OR NOT v_bot.eh_bot OR v_bot.desistiu OR v_bot.saldo <= 0 THEN
    RETURN public.estado_mesa(p_partida);
  END IF;

  SELECT segredo INTO v_segredo FROM public.segredos WHERE jogador_id = v_bot.id;
  IF v_segredo IS NULL THEN
    RETURN public.estado_mesa(p_partida);
  END IF;

  IF v_p.fase_blind > 0 THEN
    RETURN public.pagar_blind(v_bot.id, v_segredo);
  END IF;

  SELECT c1, c2 INTO v_c1, v_c2
  FROM public.cartas_privadas
  WHERE partida_id = v_p.id AND jogador_id = v_bot.id AND mao = v_p.mao;

  v_falta := greatest(0, v_p.aposta_atual - v_bot.apostou);
  v_pote := greatest(1, v_p.pote);
  v_bb := greatest(1, v_p.big_blind);
  v_sb := greatest(1, least(v_bb, coalesce(nullif(v_p.small_blind, 0), greatest(1, v_bb / 2))));
  v_passo := greatest(1, public.passo_aposta(v_p.id));

  SELECT count(*) INTO v_outros_fichas
  FROM public.jogadores
  WHERE partida_id = v_p.id AND id <> v_bot.id AND NOT desistiu AND saldo > 0;

  SELECT count(*) INTO v_ativos
  FROM public.jogadores
  WHERE partida_id = v_p.id AND NOT desistiu AND NOT esperando;

  v_pode_aumentar := (v_bot.saldo > v_falta AND v_outros_fichas > 0);
  v_min_aposta := v_falta + v_bb;
  IF v_passo > 1 THEN
    v_min_aposta := (ceil((v_bot.apostou + v_min_aposta)::numeric / v_passo)::int * v_passo) - v_bot.apostou;
  END IF;
  v_min_aposta := least(v_bot.saldo, greatest(v_falta + 1, v_min_aposta));

  v_pot_odds := CASE
    WHEN v_falta > 0 THEN least(v_falta, v_bot.saldo)::numeric / (v_pote + least(v_falta, v_bot.saldo))
    ELSE 0
  END;
  v_spr := v_bot.saldo::numeric / greatest(v_pote, v_bb);

  -- Posição relativa ao dealer
  SELECT ordem INTO v_ord_dealer FROM public.jogadores WHERE id = v_p.dealer_jogador_id;
  SELECT count(*) INTO v_total_pos
  FROM public.jogadores
  WHERE partida_id = v_p.id AND NOT esperando AND NOT desistiu;
  IF v_ord_dealer IS NOT NULL AND v_total_pos >= 4 THEN
    SELECT count(*) INTO v_dist_dealer
    FROM public.jogadores
    WHERE partida_id = v_p.id
      AND NOT esperando
      AND NOT desistiu
      AND ((ordem > v_bot.ordem AND ordem <= v_ord_dealer)
           OR (v_bot.ordem > v_ord_dealer AND (ordem > v_bot.ordem OR ordem <= v_ord_dealer)));
    v_pos_tardia := (v_bot.id = v_p.dealer_jogador_id OR v_dist_dealer <= 1);
  END IF;

  v_board_len := coalesce(array_length(v_p.board, 1), 0);

  IF v_c1 IS NOT NULL AND v_c2 IS NOT NULL THEN
    IF v_p.fase = 0 OR v_board_len < 3 THEN
      v_forca := public.bot_forca_preflop(v_c1, v_c2);
    ELSE
      v_av := public.avaliar_mao_online(array[v_c1, v_c2] || v_p.board);
      v_score := (v_av->>'score')::bigint;
      v_cat := (v_score / 1048576)::int;
      v_r1 := ((v_score / 65536) % 16)::int;

      v_r_c1 := CASE substr(v_c1, 1, 1)
        WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5
        WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9
        WHEN 'T' THEN 10 WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14 ELSE 0 END;
      v_r_c2 := CASE substr(v_c2, 1, 1)
        WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5
        WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9
        WHEN 'T' THEN 10 WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14 ELSE 0 END;

      FOREACH v_b IN ARRAY v_p.board LOOP
        v_br := CASE substr(v_b, 1, 1)
          WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5
          WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9
          WHEN 'T' THEN 10 WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14 ELSE 0 END;
        IF v_br > v_max_board THEN v_max_board := v_br; END IF;
      END LOOP;

      v_par_privado := (v_r_c1 = v_r1 OR v_r_c2 = v_r1);

      v_forca := CASE v_cat
        WHEN 0 THEN 0.14 + (greatest(v_r_c1, v_r_c2) - 2) * 0.01
        WHEN 1 THEN
          CASE
            WHEN NOT v_par_privado THEN 0.24
            WHEN v_r1 >= v_max_board THEN 0.62
            WHEN v_r1 >= 10 THEN 0.50
            ELSE 0.40
          END
        WHEN 2 THEN 0.74 + least(0.06, (v_r1 - 6) * 0.008)
        WHEN 3 THEN 0.84
        WHEN 4 THEN 0.90
        WHEN 5 THEN 0.94
        ELSE 0.98
      END;

      IF v_board_len BETWEEN 3 AND 4 THEN
        v_draws := public.bot_tem_draw(array[v_c1, v_c2] || v_p.board);
        v_flush_draw := coalesce((v_draws->>'flush_draw')::boolean, false);
        v_oesd := coalesce((v_draws->>'oesd')::boolean, false);
        v_gutshot := coalesce((v_draws->>'gutshot')::boolean, false);

        IF v_board_len = 3 THEN
          IF v_flush_draw THEN v_forca := least(0.95, v_forca + 0.16); END IF;
          IF v_oesd THEN v_forca := least(0.95, v_forca + 0.14); END IF;
          IF v_gutshot THEN v_forca := least(0.95, v_forca + 0.06); END IF;
        ELSE
          IF v_flush_draw THEN v_forca := least(0.95, v_forca + 0.09); END IF;
          IF v_oesd THEN v_forca := least(0.95, v_forca + 0.08); END IF;
          IF v_gutshot THEN v_forca := least(0.95, v_forca + 0.03); END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  v_nivel := coalesce(v_bot.bot_nivel, 'medio');

  IF v_nivel = 'facil' THEN
    v_eff := least(1.0, greatest(0.0, v_forca + (random() - 0.30) * 0.26));
    IF v_falta = 0 THEN
      IF v_eff >= 0.72 AND v_pode_aumentar AND v_rng < 0.45 THEN
        v_acao := 'apostar';
        v_valor := greatest(v_min_aposta, round(v_pote * 0.45)::int);
      ELSIF v_eff < 0.25 AND v_pode_aumentar AND v_rng < 0.08 THEN
        v_acao := 'apostar';
        v_valor := v_min_aposta;
      ELSE
        v_acao := 'check';
      END IF;
    ELSE
      IF v_eff >= 0.76 AND v_pode_aumentar AND v_rng < 0.25 THEN
        v_acao := 'apostar';
        v_valor := v_min_aposta;
      ELSIF v_p.fase = 0 THEN
        IF v_falta <= v_bb * 4 OR v_eff >= 0.14 OR v_falta <= (v_bot.saldo * 0.55) OR v_rng < 0.35 THEN
          v_acao := 'pagar';
        ELSE
          v_acao := 'desistir';
        END IF;
      ELSE
        IF v_eff >= 0.16 OR coalesce(v_cat, 0) >= 1 OR v_flush_draw OR v_oesd OR v_falta <= (v_pote * 0.65) OR v_falta <= (v_bot.saldo * 0.45) OR v_rng < 0.30 THEN
          v_acao := 'pagar';
        ELSE
          v_acao := 'desistir';
        END IF;
      END IF;
    END IF;

  ELSIF v_nivel = 'medio' THEN
    v_eff := least(1.0, greatest(0.0, v_forca + (random() - 0.45) * 0.14));
    IF v_p.fase = 0 THEN
      IF v_falta = 0 THEN
        IF v_eff >= 0.54 AND v_pode_aumentar THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_bb * 2.5)::int - v_bot.apostou);
        ELSE
          v_acao := 'check';
        END IF;
      ELSE
        IF v_eff >= 0.68 AND v_pode_aumentar AND v_p.aposta_atual <= v_bb * 4 AND v_rng < 0.50 THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, (v_p.aposta_atual * 3) - v_bot.apostou);
        ELSIF v_falta <= v_bb THEN
          IF v_eff >= 0.18 OR v_rng < 0.55 THEN
            v_acao := 'pagar';
          ELSE
            v_acao := 'desistir';
          END IF;
        ELSIF v_falta <= v_bb * 4 THEN
          IF v_eff >= 0.24 OR (v_eff >= 0.18 AND v_rng < 0.45) THEN
            v_acao := 'pagar';
          ELSE
            v_acao := 'desistir';
          END IF;
        ELSIF v_eff >= least(0.62, 0.28 + (v_falta::numeric / greatest(1, v_bot.saldo)) * 0.48) THEN
          v_acao := 'pagar';
        ELSE
          v_acao := 'desistir';
        END IF;
      END IF;
    ELSE
      IF v_falta = 0 THEN
        IF v_eff >= 0.60 AND v_pode_aumentar THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_pote * (0.45 + random() * 0.20))::int);
        ELSIF (v_flush_draw OR v_oesd OR v_rng < 0.12) AND v_pode_aumentar AND v_rng < 0.35 THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_pote * 0.45)::int);
        ELSE
          v_acao := 'check';
        END IF;
      ELSE
        IF v_eff >= 0.78 AND v_pode_aumentar AND v_rng < 0.48 THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_falta + v_pote * 0.55)::int);
        ELSIF v_eff >= greatest(0.20, v_pot_odds - 0.04)
           OR (coalesce(v_cat, 0) >= 1 AND coalesce(v_par_privado, false) AND v_falta <= v_pote * 1.15)
           OR ((v_flush_draw OR v_oesd OR v_gutshot) AND v_falta <= v_pote)
           OR (v_p.fase = 1 AND v_falta <= v_pote * 0.65 AND v_rng < 0.35) THEN
          v_acao := 'pagar';
        ELSE
          v_acao := 'desistir';
        END IF;
      END IF;
    END IF;

  ELSE
    -- 'dificil': TAG/LAG consciente de posição, multiway, SPR, pot odds e semi-blefes
    v_eff := v_forca + (random() - 0.50) * 0.06;
    IF v_pos_tardia THEN v_eff := v_eff + 0.07; END IF;
    IF v_ativos > 2 THEN v_eff := v_eff - least(0.12, (v_ativos - 2) * 0.04); END IF;
    v_eff := least(1.0, greatest(0.0, v_eff));

    IF v_p.fase = 0 THEN
      IF v_falta = 0 THEN
        IF (v_eff >= 0.56 OR (v_pos_tardia AND v_eff >= 0.46)) AND v_pode_aumentar THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_bb * (CASE WHEN v_pos_tardia THEN 2.3 ELSE 2.8 END))::int - v_bot.apostou);
        ELSE
          v_acao := 'check';
        END IF;
      ELSE
        IF v_bot.saldo <= v_bb * 10 AND v_eff >= 0.64 AND v_pode_aumentar THEN
          v_acao := 'apostar';
          v_valor := v_bot.saldo;
        ELSIF v_eff >= 0.78 AND v_pode_aumentar AND v_p.aposta_atual <= v_bb * 5 THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, (v_p.aposta_atual * 3) - v_bot.apostou);
        ELSIF v_eff >= least(0.76, 0.36 + v_pot_odds * 0.75) THEN
          v_acao := 'pagar';
        ELSE
          v_acao := 'desistir';
        END IF;
      END IF;
    ELSE
      IF v_falta = 0 THEN
        -- Slowplay ocasional no flop com monstro
        IF v_p.fase = 1 AND v_cat >= 3 AND v_rng < 0.18 THEN
          v_acao := 'check';
        ELSIF v_eff >= 0.58 AND v_pode_aumentar THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_pote * (CASE WHEN v_eff >= 0.80 THEN 0.68 ELSE 0.45 END))::int);
        ELSIF (v_flush_draw OR v_oesd) AND v_pode_aumentar AND (v_pos_tardia OR v_rng < 0.35) THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_pote * 0.50)::int);
        ELSIF v_pos_tardia AND v_rng < 0.14 AND v_pode_aumentar THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_pote * 0.38)::int);
        ELSE
          v_acao := 'check';
        END IF;
      ELSE
        IF v_eff >= 0.84 AND v_pode_aumentar AND (v_spr <= 2.5 OR v_rng < 0.58) THEN
          v_acao := 'apostar';
          v_valor := greatest(v_min_aposta, round(v_falta + v_pote * 0.70)::int);
        ELSIF (v_flush_draw OR v_oesd) AND v_p.fase <= 2 AND v_pot_odds <= 0.34 THEN
          IF v_pos_tardia AND v_pode_aumentar AND v_rng < 0.25 AND v_falta <= v_pote THEN
            v_acao := 'apostar';
            v_valor := greatest(v_min_aposta, round(v_falta + v_pote * 0.65)::int);
          ELSE
            v_acao := 'pagar';
          END IF;
        ELSIF v_eff >= greatest(0.32, v_pot_odds + 0.12) THEN
          v_acao := 'pagar';
        ELSE
          v_acao := 'desistir';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Normalização limpa para múltiplos organizados de SB/BB/5BB/passo (mantendo All-in exato)
  IF v_acao = 'apostar' THEN
    IF NOT v_pode_aumentar THEN
      v_acao := CASE WHEN v_falta > 0 THEN 'pagar' ELSE 'check' END;
      v_valor := 0;
    ELSE
      v_valor := least(v_bot.saldo, greatest(v_min_aposta, coalesce(v_valor, v_min_aposta)));
      IF v_valor >= round(v_bot.saldo * 0.65) THEN
        v_valor := v_bot.saldo;
      ELSIF v_valor < v_bot.saldo THEN
        v_total_alvo := v_bot.apostou + v_valor;
        v_unit := CASE
          WHEN v_total_alvo >= v_bb * 20 THEN v_bb * 5
          WHEN v_total_alvo >= v_bb * 8 THEN v_bb
          ELSE v_sb
        END;
        IF v_passo > 1 THEN
          v_unit := greatest(v_passo, (ceil(v_unit::numeric / v_passo)::int) * v_passo);
        END IF;
        v_total_alvo := round(v_total_alvo::numeric / v_unit)::int * v_unit;
        v_alvo := v_total_alvo - v_bot.apostou;
        IF v_alvo < v_min_aposta THEN
          v_alvo := (ceil((v_bot.apostou + v_min_aposta)::numeric / v_unit)::int * v_unit) - v_bot.apostou;
        END IF;
        v_valor := least(v_bot.saldo, greatest(v_min_aposta, v_alvo));
      END IF;
      IF v_valor <= v_falta AND v_valor < v_bot.saldo THEN
        v_acao := CASE WHEN v_falta > 0 THEN 'pagar' ELSE 'check' END;
        v_valor := 0;
      END IF;
    END IF;
  ELSIF v_acao = 'check' AND v_falta > 0 THEN
    v_acao := 'desistir';
    v_valor := 0;
  ELSIF v_acao = 'pagar' AND v_falta <= 0 THEN
    v_acao := 'check';
    v_valor := 0;
  ELSE
    v_valor := 0;
  END IF;

  RETURN public.jogar(v_bot.id, v_segredo, v_acao, coalesce(v_valor, 0));
END;
$function$;
