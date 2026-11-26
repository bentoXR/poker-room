-- =====================================================================
-- POKER ROOM: Otimização de Banco de Dados, Índices, Realtime e RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1A. Enxugar publicação Realtime (apenas public.partidas é assinada)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 1B. Índices de FK, cobertura e consultas quentes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_jogadores_conta_id
  ON public.jogadores (conta_id)
  WHERE conta_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fichas_guardadas_conta_id
  ON public.fichas_guardadas (conta_id);

CREATE INDEX IF NOT EXISTS idx_presenca_partida_id
  ON public.presenca (partida_id);

CREATE INDEX IF NOT EXISTS idx_operacoes_fichas_partida_id
  ON public.operacoes_fichas (partida_id);

CREATE INDEX IF NOT EXISTS idx_historico_partida_id_desc_cov
  ON public.historico (partida_id, id DESC)
  INCLUDE (mao, texto, tipo);

DROP INDEX IF EXISTS public.historico_partida_id_id_idx;

CREATE INDEX IF NOT EXISTS idx_jogadores_partida_ordem
  ON public.jogadores (partida_id, ordem);

DROP INDEX IF EXISTS public.jogadores_partida_idx;

DROP INDEX IF EXISTS public.idx_partidas_ativas_ultima_mao;

CREATE INDEX IF NOT EXISTS idx_partidas_abertas_ultima_mao
  ON public.partidas (ultima_mao_em DESC)
  WHERE NOT encerrada;

-- ---------------------------------------------------------------------
-- 1C. Fixar search_path das funções de trigger
-- ---------------------------------------------------------------------
ALTER FUNCTION public.bump_versao() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.marcar_vez() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.travar_valor_real() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.trg_limpar_esperando() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.trg_novo_jogador_esperando() SET search_path TO 'public', 'pg_temp';

-- ---------------------------------------------------------------------
-- 1D. Otimização das RPCs mais quentes
-- ---------------------------------------------------------------------

-- 1) listar_salas direto em 1 query com LATERAL (sem wrapper JSONB)
CREATE OR REPLACE FUNCTION public.listar_salas(p_conta uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  RETURN (
    SELECT coalesce(
      jsonb_agg(to_jsonb(s) ORDER BY s.sou_jogador DESC, s.criada_em DESC),
      '[]'::jsonb
    )
    FROM (
      SELECT
        p.id,
        coalesce(p.nome, 'Sala ' || p.codigo) AS nome,
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
        (ps.partida_id IS NOT NULL) AS tem_senha,
        coalesce(jagg.n_jogadores, 0) AS n_jogadores,
        coalesce(jagg.sou_jogador, false) AS sou_jogador,
        coalesce(jagg.sou_criador, false) AS sou_criador
      FROM public.partidas p
      LEFT JOIN public.partidas_senhas ps
        ON ps.partida_id = p.id
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE NOT j.eh_bot AND NOT j.espectando)::bigint AS n_jogadores,
          bool_or(j.conta_id = p_conta) AS sou_jogador,
          bool_or(j.conta_id = p_conta AND j.criador) AS sou_criador
        FROM public.jogadores j
        WHERE j.partida_id = p.id
      ) jagg ON true
      WHERE NOT p.encerrada
        AND NOT p.dev
        AND NOT p.solo_bots
        AND p.ultima_mao_em > now() - interval '5 minutes'
      ORDER BY coalesce(jagg.sou_jogador, false) DESC, p.criada_em DESC
      LIMIT 50
    ) s
  );
END;
$function$;

-- 2) estado_mesa_se_mudou: evita serializar estado completo em polling/broadcast redundante
CREATE OR REPLACE FUNCTION public.estado_mesa_se_mudou(p_partida uuid, p_versao bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_versao bigint;
  v_encerrada boolean;
BEGIN
  SELECT versao, encerrada
    INTO v_versao, v_encerrada
  FROM public.partidas
  WHERE id = p_partida;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT v_encerrada AND p_versao IS NOT NULL AND v_versao <= p_versao THEN
    RETURN jsonb_build_object(
      'sem_mudanca', true,
      'versao', v_versao,
      'agora', now()
    );
  END IF;

  RETURN public.estado_mesa(p_partida);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.estado_mesa_se_mudou(uuid, bigint) TO anon, authenticated;

-- 3) ping_sala: check único + throttle de escrita (evita WAL churn < 20s)
CREATE OR REPLACE FUNCTION public.ping_sala(p_jogador uuid, p_segredo uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
BEGIN
  SELECT j.partida_id INTO v_pid
  FROM public.jogadores j
  JOIN public.segredos s ON s.jogador_id = j.id
  WHERE j.id = p_jogador AND s.segredo = p_segredo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogador não reconhecido.';
  END IF;

  INSERT INTO public.presenca (jogador_id, partida_id, ultimo_sinal)
  VALUES (p_jogador, v_pid, now())
  ON CONFLICT (jogador_id) DO UPDATE
  SET partida_id = EXCLUDED.partida_id,
      ultimo_sinal = now()
  WHERE public.presenca.ultimo_sinal < now() - interval '20 seconds';
END;
$function$;

-- 4) resolver_showdown_online: coalesce board = v_board[1:5] no UPDATE final
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

  -- Avalia e revela as cartas de todos os jogadores ativos no showdown
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

  -- Constrói fatias de pote principal + potes laterais pelos níveis dos jogadores ativos
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
  set apostou = 0, desistiu = false, falou = false, confirmado = false
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

-- 5) jogar: coalesce múltiplas atualizações de partidas em 1 único UPDATE
CREATE OR REPLACE FUNCTION public.jogar(p_jogador uuid, p_segredo uuid, p_acao text, p_valor integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_j           jogadores;
  v_p           partidas;
  v_falta       int;
  v_colocar     int := 0;
  v_texto       text;
  v_restam      int;
  v_unico       uuid;
  v_proximo     uuid;
  v_novo_aposta int;
  v_novo_pote   int;
  v_fichas      int;
  v_nova        int;
  v_ordsb       int;
  v_ord_dealer  int;
  v_primeiro    uuid;
  v_passo       int;
  v_max_id      uuid;
  v_max_nome    text;
  v_max_ap      int;
  v_seg_ap      int;
  v_excesso     int;
  v_board_full  text[];
  v_board_vis   text[];
begin
  v_j := conferir_jogador(p_jogador, p_segredo);

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.pausada then
    raise exception 'A mesa está pausada pelo anfitrião.';
  end if;
  if not v_p.iniciada then
    raise exception 'A partida ainda não começou.';
  end if;
  if v_p.aguardando_proxima_mao then
    raise exception 'Aguardando a próxima mão começar.';
  end if;
  if v_p.fase_blind > 0 then
    raise exception 'Os blinds ainda não foram pagos.';
  end if;
  if v_p.aguardando_cartas then
    raise exception 'Aguarde as cartas serem viradas.';
  end if;
  if v_p.fase = 4 then
    raise exception 'A mão acabou. Aguarde o criador distribuir o pote.';
  end if;
  if v_p.vez_jogador_id is distinct from v_j.id then
    raise exception 'Não é a sua vez.';
  end if;

  v_falta := v_p.aposta_atual - v_j.apostou;

  if p_acao = 'desistir' then
    v_texto := v_j.nome || ' desistiu';

  elsif p_acao = 'check' then
    if v_falta > 0 then
      raise exception 'Há aposta a pagar, não dá para dar check.';
    end if;
    v_texto := v_j.nome || ' deu check';

  elsif p_acao = 'pagar' then
    if v_falta <= 0 then
      raise exception 'Não há nada a pagar.';
    end if;
    v_colocar := least(v_falta, v_j.saldo);
    v_texto := v_j.nome || ' pagou ' || v_colocar;
    if v_colocar = v_j.saldo then v_texto := v_texto || ' (all-in)'; end if;

  elsif p_acao = 'apostar' then
    if coalesce(p_valor, 0) <= 0 then
      raise exception 'Digite um valor para apostar.';
    end if;
    if p_valor > v_j.saldo then
      raise exception 'Você não tem fichas suficientes.';
    end if;
    if p_valor > v_falta and not exists (
      select 1 from jogadores
      where partida_id = v_p.id and id <> v_j.id and desistiu = false and saldo > 0
    ) then
      raise exception 'Todos os outros jogadores já estão em all-in. Só é possível pagar ou desistir.';
    end if;
    v_passo := passo_aposta(v_p.id);
    if v_passo > 1 and p_valor < v_j.saldo and ((v_j.apostou + p_valor) % v_passo) <> 0 then
      raise exception 'Nesta sala as apostas devem ser múltiplas de % fichas.', v_passo;
    end if;
    if p_valor <= v_falta and p_valor < v_j.saldo then
      raise exception 'Para aumentar, aposte mais que o valor de pagar (%).', v_falta;
    end if;
    v_colocar := p_valor;
    v_texto := v_j.nome || ' apostou ' || v_colocar;
    if v_colocar = v_j.saldo then v_texto := v_texto || ' (all-in)'; end if;

  else
    raise exception 'Ação desconhecida.';
  end if;

  if p_acao = 'desistir' then
    update jogadores set desistiu = true, falou = true where id = v_j.id;
  else
    update jogadores
    set saldo = saldo - v_colocar,
        apostou = apostou + v_colocar,
        total_mao = total_mao + v_colocar,
        falou = true
    where id = v_j.id;
  end if;

  v_novo_aposta := greatest(v_p.aposta_atual, v_j.apostou + v_colocar);
  v_novo_pote := v_p.pote + v_colocar;

  if v_novo_aposta > v_p.aposta_atual then
    update jogadores set falou = false
    where partida_id = v_p.id and id <> v_j.id and desistiu = false and saldo > 0;
  end if;

  perform registrar(v_p.id, v_texto, 'acao');

  select count(*), (array_agg(id))[1]
    into v_restam, v_unico
  from jogadores
  where partida_id = v_p.id and desistiu = false and (saldo > 0 or total_mao > 0);

  if v_restam = 1 then
    update partidas
    set pote = v_novo_pote, aposta_atual = v_novo_aposta, agiu = false
    where id = v_p.id;
    perform premiar_unico(v_p.id, v_unico);
    return estado_mesa(v_p.id);
  end if;

  select count(*) into v_fichas
  from jogadores where partida_id = v_p.id and desistiu = false and saldo > 0;

  if v_fichas >= 2 or exists (
    select 1 from jogadores
    where partida_id = v_p.id and desistiu = false and saldo > 0 and apostou < v_novo_aposta
  ) then
    select j.id into v_proximo
    from jogadores j
    where j.partida_id = v_p.id
      and j.id <> v_j.id
      and j.desistiu = false
      and j.saldo > 0
      and (not j.falou or j.apostou < v_novo_aposta)
    order by (j.ordem > v_j.ordem) desc, j.ordem
    limit 1;
  else
    v_proximo := null;
  end if;

  if v_proximo is not null then
    update partidas
    set pote = v_novo_pote,
        aposta_atual = v_novo_aposta,
        agiu = false,
        vez_jogador_id = v_proximo
    where id = v_p.id;
    return estado_mesa(v_p.id);
  end if;

  select id, nome, apostou into v_max_id, v_max_nome, v_max_ap
  from jogadores
  where partida_id = v_p.id and desistiu = false and apostou > 0
  order by apostou desc
  limit 1;

  if v_max_id is not null then
    select coalesce(max(apostou), 0) into v_seg_ap
    from jogadores
    where partida_id = v_p.id and id <> v_max_id;

    if v_max_ap > v_seg_ap then
      v_excesso := v_max_ap - v_seg_ap;
      update jogadores
      set saldo = saldo + v_excesso,
          apostou = apostou - v_excesso,
          total_mao = total_mao - v_excesso
      where id = v_max_id;

      v_novo_pote := v_novo_pote - v_excesso;
      perform registrar(v_p.id, v_max_nome || ' recebeu de volta ' || v_excesso || ' (aposta não paga)');
    end if;
  end if;

  update jogadores set apostou = 0, falou = false where partida_id = v_p.id;

  if v_p.modo = 'online' then
    if v_p.fase >= 3 or v_fichas < 2 then
      perform resolver_showdown_online(v_p.id);
    else
      v_nova := v_p.fase + 1;
      select board_oculto into v_board_full from baralhos_online where partida_id = v_p.id;
      v_board_vis := case v_nova
        when 1 then v_board_full[1:3]
        when 2 then v_board_full[1:4]
        else v_board_full[1:5]
      end;

      select ordem into v_ord_dealer from jogadores where id = v_p.dealer_jogador_id;
      select j.id into v_primeiro
      from jogadores j
      where j.partida_id = v_p.id and j.desistiu = false and j.saldo > 0
      order by (j.ordem > coalesce(v_ord_dealer, 0)) desc, j.ordem
      limit 1;

      update partidas
      set pote = v_novo_pote,
          fase = v_nova,
          aposta_atual = 0,
          agiu = false,
          aguardando_cartas = false,
          board = v_board_vis,
          vez_jogador_id = v_primeiro
      where id = v_p.id;

      perform registrar(
        v_p.id,
        case v_nova
          when 1 then 'Flop: ' || formatar_carta_log(v_board_full[1]) || ' ' || formatar_carta_log(v_board_full[2]) || ' ' || formatar_carta_log(v_board_full[3])
          when 2 then 'Turn: ' || formatar_carta_log(v_board_full[4])
          else 'River: ' || formatar_carta_log(v_board_full[5])
        end
      );
    end if;

    return estado_mesa(v_p.id);
  end if;

  if v_p.fase >= 3 or v_fichas < 2 then
    update partidas
    set pote = v_novo_pote,
        fase = 4,
        aguardando_cartas = false,
        vez_jogador_id = null,
        aposta_atual = 0,
        agiu = false
    where id = v_p.id;
    perform registrar(
      v_p.id,
      case when v_p.fase < 3 then 'Todos all-in: virem as cartas restantes e mostrem as mãos'
           else 'Showdown: mostrem as cartas' end
    );
  else
    v_nova := v_p.fase + 1;
    select ordem into v_ordsb from jogadores where id = v_p.sb_jogador_id;

    select j.id into v_primeiro
    from jogadores j
    where j.partida_id = v_p.id and j.desistiu = false and j.saldo > 0
    order by (j.ordem >= coalesce(v_ordsb, 0)) desc, j.ordem
    limit 1;

    update partidas
    set pote = v_novo_pote,
        fase = v_nova,
        aposta_atual = 0,
        agiu = false,
        aguardando_cartas = true,
        vez_jogador_id = v_primeiro
    where id = v_p.id;

    perform registrar(
      v_p.id,
      case v_nova when 1 then 'Flop: virem 3 cartas'
                  when 2 then 'Turn: vire a 4ª carta'
                  else 'River: vire a 5ª carta' end
    );
  end if;

  return estado_mesa(v_p.id);
end;
$function$;

-- 6) pagar_blind: coalesce UPDATE partidas na fase_blind = 2
CREATE OR REPLACE FUNCTION public.pagar_blind(p_jogador uuid, p_segredo uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_j           jogadores;
  v_p           partidas;
  v_valor       int;
  v_ordem       int;
  v_prox        uuid;
  v_nova_aposta int;
  v_novo_pote   int;
  v_com_fichas  int;
  v_devem_pagar int;
  v_max_id      uuid;
  v_max_nome    text;
  v_max_ap      int;
  v_seg_ap      int;
  v_excesso     int;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.pausada then
    raise exception 'A mesa está pausada pelo anfitrião.';
  end if;
  if not v_p.iniciada or v_p.fase_blind = 0 then
    raise exception 'Não há blind para pagar agora.';
  end if;
  if v_p.vez_jogador_id is distinct from v_j.id then
    raise exception 'Não é a sua vez de pagar o blind.';
  end if;

  v_valor := least(
    case when v_p.fase_blind = 1 then v_p.small_blind else v_p.big_blind end,
    v_j.saldo
  );

  update jogadores
  set saldo = saldo - v_valor, apostou = apostou + v_valor, total_mao = total_mao + v_valor
  where id = v_j.id;

  perform registrar(
    v_p.id,
    v_j.nome || ' pagou o ' || case when v_p.fase_blind = 1 then 'small' else 'big' end
      || ' blind (' || v_valor || ')',
    'blind'
  );

  v_nova_aposta := greatest(v_p.aposta_atual, v_valor);
  v_novo_pote := v_p.pote + v_valor;

  if v_p.fase_blind = 1 then
    update partidas
    set pote = v_novo_pote,
        aposta_atual = v_nova_aposta,
        fase_blind = 2,
        vez_jogador_id = v_p.bb_jogador_id,
        vez_desde = now()
    where id = v_p.id;
  else
    select count(*),
           count(*) filter (where apostou < v_nova_aposta)
      into v_com_fichas, v_devem_pagar
    from jogadores
    where partida_id = v_p.id and desistiu = false and saldo > 0;

    if v_com_fichas = 0 or (v_com_fichas = 1 and v_devem_pagar = 0) then
      select id, nome, apostou into v_max_id, v_max_nome, v_max_ap
      from jogadores
      where partida_id = v_p.id and desistiu = false and apostou > 0
      order by apostou desc
      limit 1;

      if v_max_id is not null then
        select coalesce(max(apostou), 0) into v_seg_ap
        from jogadores
        where partida_id = v_p.id and id <> v_max_id;

        if v_max_ap > v_seg_ap then
          v_excesso := v_max_ap - v_seg_ap;
          update jogadores
          set saldo = saldo + v_excesso,
              apostou = apostou - v_excesso,
              total_mao = total_mao - v_excesso
          where id = v_max_id;

          v_novo_pote := v_novo_pote - v_excesso;
          perform registrar(v_p.id, v_max_nome || ' recebeu de volta ' || v_excesso || ' (aposta não paga)');
        end if;
      end if;

      update jogadores set apostou = 0, falou = false where partida_id = v_p.id;

      if v_p.modo = 'online' then
        perform resolver_showdown_online(v_p.id);
      else
        update partidas
        set pote = v_novo_pote,
            fase_blind = 0,
            agiu = false,
            vez_jogador_id = null,
            aposta_atual = 0,
            fase = 4,
            aguardando_cartas = false
        where id = v_p.id;
        perform registrar(v_p.id, 'Todos all-in: virem as cartas restantes e mostrem as mãos');
      end if;
    else
      select ordem into v_ordem from jogadores where id = v_p.primeiro_jogador_id;

      select j.id into v_prox
      from jogadores j
      where j.partida_id = v_p.id and j.desistiu = false and j.saldo > 0
      order by (j.ordem >= coalesce(v_ordem, 0)) desc, j.ordem
      limit 1;

      update partidas
      set pote = v_novo_pote,
          aposta_atual = v_nova_aposta,
          fase_blind = 0,
          agiu = false,
          vez_jogador_id = v_prox,
          vez_desde = now(),
          fase = case when v_prox is null then 4 else 0 end
      where id = v_p.id;
    end if;
  end if;

  return estado_mesa(v_p.id);
end;
$function$;

-- 7) tirar_jogador_da_partida: 1 único UPDATE condicional em partidas
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

-- 8) gerenciar_bots_sala: só dispara bump_versao se realmente mudou algo
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
  v_mudou boolean := false;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida;
  IF NOT FOUND
     OR v_p.modo <> 'online'
     OR v_p.encerrada
     OR (NOT v_p.com_bots AND NOT v_p.solo_bots)
     OR (v_p.iniciada AND NOT v_p.aguardando_proxima_mao) THEN
    RETURN;
  END IF;

  FOR v_bot IN
    SELECT id, nome FROM public.jogadores
    WHERE partida_id = p_partida AND eh_bot = true AND saldo <= 0
  LOOP
    PERFORM public.tirar_jogador_da_partida(p_partida, v_bot.id);
    PERFORM public.registrar(p_partida, v_bot.nome || ' saiu da mesa');
    v_mudou := true;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE NOT espectando),
    count(*) FILTER (WHERE eh_bot),
    count(*) FILTER (WHERE NOT eh_bot AND NOT espectando)
  INTO v_ocupados, v_bots, v_humanos
  FROM public.jogadores
  WHERE partida_id = p_partida;

  IF NOT v_p.iniciada AND v_p.mao = 1 AND v_bots = 0 THEN
    v_alvo := least(8 - v_humanos, 3 + floor(random() * 4)::int);
    v_alvo := greatest(3, least(6, v_alvo));
    FOR v_i IN 1..v_alvo LOOP
      EXIT WHEN (v_humanos + v_i - 1) >= 8;
      IF public.adicionar_bot_sala(p_partida, NULL) IS NOT NULL THEN
        v_mudou := true;
      END IF;
    END LOOP;
  ELSE
    IF v_bots < 3 AND v_ocupados < 8 THEN
      v_alvo := least(3 - v_bots, 8 - v_ocupados);
      FOR v_i IN 1..v_alvo LOOP
        IF public.adicionar_bot_sala(p_partida, NULL) IS NOT NULL THEN
          v_mudou := true;
        END IF;
      END LOOP;
    ELSIF v_ocupados < 8 AND random() < 0.35 THEN
      IF public.adicionar_bot_sala(p_partida, NULL) IS NOT NULL THEN
        v_mudou := true;
      END IF;
    ELSIF v_bots >= 5 AND v_ocupados >= 6 AND random() < 0.15 THEN
      SELECT id, nome INTO v_sair_id, v_sair_nome
      FROM public.jogadores
      WHERE partida_id = p_partida AND eh_bot = true AND saldo > 0
      ORDER BY random()
      LIMIT 1;
      IF v_sair_id IS NOT NULL THEN
        PERFORM public.tirar_jogador_da_partida(p_partida, v_sair_id);
        PERFORM public.registrar(p_partida, v_sair_nome || ' saiu da mesa');
        v_mudou := true;
      END IF;
    END IF;
  END IF;

  IF v_mudou THEN
    UPDATE public.partidas SET versao = versao WHERE id = p_partida;
  END IF;
END;
$function$;

-- 9) bot_agir_online: pré-check sem lock e retorno sem_mudanca em no-op
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
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.partidas p
    JOIN public.jogadores j ON j.id = p.vez_jogador_id
    WHERE p.id = p_partida
      AND p.modo = 'online'
      AND NOT p.encerrada
      AND NOT p.pausada
      AND p.iniciada
      AND NOT p.aguardando_proxima_mao
      AND NOT p.aguardando_cartas
      AND p.fase < 4
      AND j.eh_bot
      AND NOT j.desistiu
      AND j.saldo > 0
  ) THEN
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

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
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  SELECT * INTO v_bot FROM public.jogadores WHERE id = v_p.vez_jogador_id;
  IF NOT FOUND OR NOT v_bot.eh_bot OR v_bot.desistiu OR v_bot.saldo <= 0 THEN
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  SELECT segredo INTO v_segredo FROM public.segredos WHERE jogador_id = v_bot.id;
  IF v_segredo IS NULL THEN
    RETURN jsonb_build_object('sem_mudanca', true);
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

  IF v_acao = 'apostar' THEN
    IF NOT v_pode_aumentar THEN
      v_acao := CASE WHEN v_falta > 0 THEN 'pagar' ELSE 'check' END;
      v_valor := 0;
    ELSE
      v_valor := least(v_bot.saldo, greatest(v_min_aposta, coalesce(v_valor, v_min_aposta)));
      IF v_valor >= round(v_bot.saldo * 0.65) THEN
        v_valor := v_bot.saldo;
      ELSIF v_passo > 1 AND v_valor < v_bot.saldo THEN
        v_alvo := (ceil((v_bot.apostou + v_valor)::numeric / v_passo)::int * v_passo) - v_bot.apostou;
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

-- 10) bot_confirmar_online: pré-check sem lock e sem bump de versao em no-op
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
  v_versao_antes bigint;
  v_mudou boolean := false;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida;
  IF NOT FOUND
     OR v_p.modo <> 'online'
     OR v_p.encerrada
     OR v_p.pausada
     OR (v_p.iniciada AND NOT v_p.aguardando_proxima_mao) THEN
    RETURN jsonb_build_object('sem_mudanca', true);
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
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida FOR UPDATE;
  IF NOT FOUND
     OR v_p.modo <> 'online'
     OR v_p.encerrada
     OR v_p.pausada
     OR (v_p.iniciada AND NOT v_p.aguardando_proxima_mao) THEN
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  v_versao_antes := v_p.versao;

  SELECT count(*) INTO v_humanos_pendentes
  FROM public.jogadores
  WHERE partida_id = v_p.id
    AND eh_bot = false
    AND NOT espectando
    AND saldo > 0
    AND NOT ausente
    AND NOT confirmado;

  IF v_humanos_pendentes > 0 AND v_p.proxima_mao_em IS NULL THEN
    RETURN jsonb_build_object('sem_mudanca', true);
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
    v_mudou := true;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE confirmado)
    INTO v_elegiveis, v_confirmados
  FROM public.jogadores
  WHERE partida_id = v_p.id AND NOT espectando AND saldo > 0 AND NOT ausente;

  IF v_confirmados >= 2 AND v_confirmados = v_elegiveis THEN
    PERFORM public.iniciar_mao_online(v_p.id);
    v_mudou := true;
  ELSIF v_confirmados >= 2 AND v_p.proxima_mao_em IS NULL THEN
    UPDATE public.partidas SET proxima_mao_em = now() + interval '30 seconds' WHERE id = v_p.id;
    v_mudou := true;
  ELSIF v_mudou THEN
    UPDATE public.partidas SET versao = versao WHERE id = v_p.id;
  ELSE
    SELECT versao INTO v_p.versao FROM public.partidas WHERE id = v_p.id;
    IF v_p.versao IS DISTINCT FROM v_versao_antes THEN
      v_mudou := true;
    END IF;
  END IF;

  IF NOT v_mudou THEN
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  RETURN public.estado_mesa(v_p.id);
END;
$function$;

-- 11) avancar_tempo_online: pré-check sem lock e retorno sem_mudanca em no-op
CREATE OR REPLACE FUNCTION public.avancar_tempo_online(p_partida uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_p           partidas;
  v_j           jogadores;
  v_seg         uuid;
  v_acao        text;
  v_confirmados int;
  v_p_apos      partidas;
  v_mudou       boolean := false;
begin
  select * into v_p from partidas where id = p_partida;
  if not found or v_p.modo <> 'online' or v_p.encerrada then
    return jsonb_build_object('sem_mudanca', true);
  end if;

  if not (
    (v_p.votacao is not null and (v_p.votacao->>'expira_em')::timestamptz <= now())
    or (not v_p.pausada and v_p.aguardando_proxima_mao
        and exists (select 1 from jogadores where partida_id = v_p.id and maos_inativo >= 3))
    or (not v_p.pausada and v_p.iniciada and not v_p.aguardando_proxima_mao and v_p.fase < 4
        and coalesce(v_p.tempo_turno, 0) > 0
        and v_p.vez_jogador_id is not null and v_p.vez_desde is not null
        and now() >= v_p.vez_desde + make_interval(secs => v_p.tempo_turno))
    or (not v_p.pausada and (not v_p.iniciada or v_p.aguardando_proxima_mao)
        and v_p.proxima_mao_em is not null
        and now() >= v_p.proxima_mao_em)
  ) then
    return jsonb_build_object('sem_mudanca', true);
  end if;

  select * into v_p from partidas where id = p_partida for update;
  if not found or v_p.modo <> 'online' or v_p.encerrada then
    return jsonb_build_object('sem_mudanca', true);
  end if;

  if v_p.votacao is not null and (v_p.votacao->>'expira_em')::timestamptz <= now() then
    update partidas set votacao = null where id = v_p.id;
    perform registrar(v_p.id, '⌛ Votação encerrada sem maioria.');
    v_p.votacao := null;
    v_mudou := true;
  end if;

  if v_p.pausada then
    return case when v_mudou then estado_mesa(p_partida) else jsonb_build_object('sem_mudanca', true) end;
  end if;

  if v_p.aguardando_proxima_mao
     and exists (select 1 from jogadores where partida_id = v_p.id and maos_inativo >= 3) then
    if expulsar_jogadores_inativos(v_p.id) > 0 then
      v_mudou := true;
    end if;
  end if;

  if v_p.iniciada and not v_p.aguardando_proxima_mao and v_p.fase < 4
     and coalesce(v_p.tempo_turno, 0) > 0
     and v_p.vez_jogador_id is not null and v_p.vez_desde is not null
     and now() >= v_p.vez_desde + make_interval(secs => v_p.tempo_turno) then

    select * into v_j from jogadores where id = v_p.vez_jogador_id;
    select segredo into v_seg from segredos where jogador_id = v_j.id;

    if found and v_seg is not null then
      perform set_config('poker.auto_timeout', '1', true);

      if v_p.fase_blind > 0 then
        perform pagar_blind(v_j.id, v_seg);
      else
        v_acao := case when (v_p.aposta_atual - v_j.apostou) <= 0 then 'check' else 'desistir' end;
        perform jogar(v_j.id, v_seg, v_acao, 0);
        update historico
        set texto = texto || ' (tempo esgotado)'
        where id = (
          select id from historico
          where partida_id = v_p.id and tipo = 'acao'
          order by id desc limit 1
        );
      end if;

      if coalesce(v_j.ultima_mao_timeout, 0) <> v_p.mao then
        update jogadores
        set maos_inativo = maos_inativo + 1,
            ultima_mao_timeout = v_p.mao
        where id = v_j.id;
      end if;

      select * into v_p_apos from partidas where id = v_p.id;
      if v_p_apos.aguardando_proxima_mao then
        perform expulsar_jogadores_inativos(v_p.id);
      end if;

      return estado_mesa(v_p.id);
    end if;
  end if;

  if (not v_p.iniciada or v_p.aguardando_proxima_mao)
     and v_p.proxima_mao_em is not null
     and now() >= v_p.proxima_mao_em then

    select count(*) into v_confirmados
    from jogadores where partida_id = v_p.id and saldo > 0 and confirmado = true and not ausente and not espectando;

    if v_confirmados >= 2 then
      perform iniciar_mao_online(v_p.id);
    else
      update partidas set proxima_mao_em = null where id = v_p.id;
    end if;
    v_mudou := true;
  end if;

  if not v_mudou then
    return jsonb_build_object('sem_mudanca', true);
  end if;

  return estado_mesa(v_p.id);
end;
$function$;

-- 12) bj_avancar_tempo: pré-check sem lock e retorno sem_mudanca em no-op
CREATE OR REPLACE FUNCTION public.bj_avancar_tempo(p_partida uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p public.partidas;
  v_bj jsonb;
  v_fase text;
  v_prazo timestamptz;
  v_maos jsonb;
  v_j_entry jsonb;
  v_lista jsonb;
  v_idx int;
  v_mao jsonb;
  v_conf int := 0;
  v_k text;
  v_mudou boolean := false;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida;
  IF NOT FOUND OR v_p.modo <> 'blackjack' OR v_p.tempo_turno <= 0 THEN
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  v_bj := v_p.blackjack_estado;
  v_fase := coalesce(v_bj->>'fase', '');
  IF v_fase = 'apostas' THEN
    v_prazo := NULLIF(v_bj->>'prazo_apostas', '')::timestamptz;
    IF v_prazo IS NULL OR v_prazo > now() THEN
      RETURN jsonb_build_object('sem_mudanca', true);
    END IF;
  ELSIF v_fase = 'jogando' AND v_p.vez_jogador_id IS NOT NULL AND v_p.vez_desde IS NOT NULL THEN
    IF v_p.vez_desde + make_interval(secs => v_p.tempo_turno) > now() THEN
      RETURN jsonb_build_object('sem_mudanca', true);
    END IF;
  ELSE
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida FOR UPDATE;
  IF NOT FOUND OR v_p.modo <> 'blackjack' OR v_p.tempo_turno <= 0 THEN
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  v_bj := v_p.blackjack_estado;
  v_fase := coalesce(v_bj->>'fase', '');

  IF v_fase = 'apostas' THEN
    v_prazo := NULLIF(v_bj->>'prazo_apostas', '')::timestamptz;
    IF v_prazo IS NOT NULL AND v_prazo <= now() THEN
      v_maos := coalesce(v_bj->'maos', '{}'::jsonb);
      FOR v_k IN SELECT jsonb_object_keys(v_maos) LOOP
        IF coalesce((v_maos->v_k->>'confirmado')::boolean, false) THEN
          v_conf := v_conf + 1;
        END IF;
      END LOOP;
      IF v_conf > 0 THEN
        PERFORM public.bj_iniciar_rodada(p_partida);
      ELSE
        UPDATE public.partidas
        SET blackjack_estado = jsonb_set(v_bj, '{prazo_apostas}', 'null'::jsonb),
            versao = versao + 1
        WHERE id = p_partida;
      END IF;
      v_mudou := true;
    END IF;
  ELSIF v_fase = 'jogando' AND v_p.vez_jogador_id IS NOT NULL AND v_p.vez_desde IS NOT NULL THEN
    IF v_p.vez_desde + make_interval(secs => v_p.tempo_turno) <= now() THEN
      v_maos := v_bj->'maos';
      v_j_entry := v_maos->(v_p.vez_jogador_id::text);
      v_lista := v_j_entry->'lista';
      v_idx := coalesce((v_j_entry->>'indice_ativa')::int, 0);
      v_mao := v_lista->v_idx;
      IF v_mao IS NOT NULL AND (v_mao->>'status') = 'jogando' THEN
        v_mao := jsonb_set(v_mao, '{status}', '"parou"'::jsonb);
        v_lista := jsonb_set(v_lista, ARRAY[v_idx::text], v_mao);
        v_j_entry := jsonb_set(v_j_entry, '{lista}', v_lista);
        v_maos := jsonb_set(v_maos, ARRAY[v_p.vez_jogador_id::text], v_j_entry);
        v_bj := jsonb_set(v_bj, '{maos}', v_maos);
        UPDATE public.partidas SET blackjack_estado = v_bj, versao = versao + 1 WHERE id = p_partida;
        PERFORM public.bj_avancar_turno(p_partida);
        v_mudou := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_mudou THEN
    RETURN jsonb_build_object('sem_mudanca', true);
  END IF;

  RETURN public.estado_mesa(p_partida);
END;
$function$;

-- ---------------------------------------------------------------------
-- 1E. Limpeza de contas DEV vazadas, otimização DEV (bcrypt bf 4) e cron
-- ---------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.dev_criar_sala(p_conta uuid, p_token uuid, p_nome text, p_saldo integer, p_small integer, p_big integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_nome text := left(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 10) || ' DEV ' || substr(md5(random()::text), 1, 4);
  v_c    public.contas;
  sala   jsonb;
  linhas int;
  pid    text;
BEGIN
  PERFORM public.conferir_conta_dev(p_conta, p_token);

  INSERT INTO public.contas (nome, senha_hash)
  VALUES (v_nome, extensions.crypt('dev' || substr(md5(random()::text), 1, 6), extensions.gen_salt('bf', 4)))
  RETURNING * INTO v_c;

  sala := public.criar_sala(
    v_c.id,
    v_c.token,
    p_saldo,
    p_small,
    p_big,
    NULL::text
  );

  pid := sala->>'partida_id';
  UPDATE public.partidas SET dev = true WHERE id::text = pid;
  GET DIAGNOSTICS linhas = ROW_COUNT;
  IF linhas <> 1 THEN
    RAISE EXCEPTION 'Não consegui marcar a sala DEV.';
  END IF;

  RETURN jsonb_build_object(
    'partida_id', pid,
    'conta_id', v_c.id,
    'token', v_c.token,
    'nome', v_c.nome,
    'jogador_id', sala->>'jogador_id',
    'segredo', sala->>'segredo'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.dev_adicionar_jogador(p_conta uuid, p_token uuid, p_partida text, p_nome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
  v_nome text := left(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 10) || ' DEV ' || substr(md5(random()::text), 1, 4);
  v_c public.contas;
  entrada jsonb;
  v_qtd int;
BEGIN
  PERFORM public.conferir_conta_dev(p_conta, p_token);

  BEGIN
    v_pid := p_partida::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Sala DEV não encontrada.';
  END;

  IF NOT EXISTS (SELECT 1 FROM public.partidas WHERE id = v_pid AND dev AND NOT encerrada) THEN
    RAISE EXCEPTION 'Sala DEV não encontrada.';
  END IF;

  SELECT count(*) INTO v_qtd FROM public.jogadores WHERE partida_id = v_pid;
  IF v_qtd >= 9 THEN
    RAISE EXCEPTION 'A sala DEV aceita no máximo 9 jogadores.';
  END IF;

  INSERT INTO public.contas (nome, senha_hash)
  VALUES (v_nome, extensions.crypt('dev' || substr(md5(random()::text), 1, 6), extensions.gen_salt('bf', 4)))
  RETURNING * INTO v_c;

  entrada := public.entrar_sala(
    v_c.id,
    v_c.token,
    v_pid
  );

  RETURN jsonb_build_object(
    'conta_id', v_c.id,
    'token', v_c.token,
    'nome', v_c.nome,
    'jogador_id', entrada->>'jogador_id',
    'segredo', entrada->>'segredo'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.dev_adicionar_bot(p_conta uuid, p_token uuid, p_partida text, p_nome text, p_nivel text DEFAULT 'medio'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
  v_nivel text;
  v_nome text := left(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 10) || ' DEV ' || substr(md5(random()::text), 1, 4);
  v_c public.contas;
  entrada jsonb;
  v_qtd int;
BEGIN
  PERFORM public.conferir_conta_dev(p_conta, p_token);

  BEGIN
    v_pid := p_partida::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Sala DEV não encontrada.';
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.partidas
    WHERE id = v_pid AND dev AND NOT encerrada AND modo = 'online'
  ) THEN
    RAISE EXCEPTION 'Sala DEV online não encontrada.';
  END IF;

  v_nivel := lower(coalesce(nullif(trim(p_nivel), ''), 'medio'));
  IF v_nivel NOT IN ('facil', 'medio', 'dificil') THEN
    RAISE EXCEPTION 'Nível de bot inválido. Use facil, medio ou dificil.';
  END IF;

  SELECT count(*) INTO v_qtd FROM public.jogadores WHERE partida_id = v_pid;
  IF v_qtd >= 9 THEN
    RAISE EXCEPTION 'A sala DEV aceita no máximo 9 jogadores.';
  END IF;

  INSERT INTO public.contas (nome, senha_hash)
  VALUES (v_nome, extensions.crypt('dev' || substr(md5(random()::text), 1, 6), extensions.gen_salt('bf', 4)))
  RETURNING * INTO v_c;

  entrada := public.entrar_sala(
    v_c.id,
    v_c.token,
    v_pid
  );

  UPDATE public.jogadores
  SET eh_bot = true,
      bot_nivel = v_nivel
  WHERE id = (entrada->>'jogador_id')::uuid;

  RETURN jsonb_build_object(
    'conta_id', v_c.id,
    'token', v_c.token,
    'nome', v_c.nome,
    'jogador_id', entrada->>'jogador_id',
    'segredo', entrada->>'segredo',
    'eh_bot', true,
    'bot_nivel', v_nivel
  );
END;
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

CREATE OR REPLACE FUNCTION public.encerrar_salas_inativas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_qtd int;
begin
  if not exists (
    select 1 from public.partidas
    where not encerrada and ultima_mao_em <= now() - interval '5 minutes'
  ) then
    return 0;
  end if;

  update public.partidas
  set encerrada = true
  where not encerrada
    and ultima_mao_em <= now() - interval '5 minutes';

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
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

DO $$
BEGIN
  PERFORM cron.alter_job(1, schedule := '*/2 * * * *');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
