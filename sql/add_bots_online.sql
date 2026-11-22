-- Adiciona suporte a Bots de Poker Online (Fácil, Médio e Difícil) rodando no servidor
-- Passo 1: Colunas, constraint e índice parcial em public.jogadores
ALTER TABLE public.jogadores
  ADD COLUMN IF NOT EXISTS eh_bot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_nivel text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jogadores_bot_nivel_check'
      AND conrelid = 'public.jogadores'::regclass
  ) THEN
    ALTER TABLE public.jogadores
      ADD CONSTRAINT jogadores_bot_nivel_check
      CHECK (bot_nivel IS NULL OR bot_nivel IN ('facil', 'medio', 'dificil'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jogadores_partida_bot
  ON public.jogadores (partida_id)
  WHERE eh_bot;

-- Passo 2: RPC dev_adicionar_bot para adicionar um bot na sala DEV online
CREATE OR REPLACE FUNCTION public.dev_adicionar_bot(
  p_conta uuid,
  p_token uuid,
  p_partida text,
  p_nome text,
  p_nivel text DEFAULT 'medio'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
  v_nivel text;
  conta jsonb;
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

  conta := public.criar_conta(
    p_nome || ' DEV ' || substr(md5(random()::text), 1, 4),
    'dev' || substr(md5(random()::text), 1, 6)
  );

  entrada := public.entrar_sala(
    (conta->>'conta_id')::uuid,
    (conta->>'token')::uuid,
    v_pid
  );

  UPDATE public.jogadores
  SET eh_bot = true,
      bot_nivel = v_nivel
  WHERE id = (entrada->>'jogador_id')::uuid;

  RETURN jsonb_build_object(
    'conta_id', conta->>'conta_id',
    'token', conta->>'token',
    'nome', conta->>'nome',
    'jogador_id', entrada->>'jogador_id',
    'segredo', entrada->>'segredo',
    'eh_bot', true,
    'bot_nivel', v_nivel
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dev_adicionar_bot(uuid, uuid, text, text, text) TO anon, authenticated;

-- Passo 3: Auxiliares de avaliação de mão para os bots
CREATE OR REPLACE FUNCTION public.bot_forca_preflop(p_c1 text, p_c2 text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_r1 int;
  v_r2 int;
  v_s1 text;
  v_s2 text;
  v_hi int;
  v_lo int;
  v_gap int;
  v_base numeric;
  v_score numeric;
BEGIN
  IF p_c1 IS NULL OR p_c2 IS NULL THEN
    RETURN 0.30;
  END IF;

  v_r1 := CASE substr(p_c1, 1, 1)
    WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5
    WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9
    WHEN 'T' THEN 10 WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14
    ELSE 0 END;
  v_r2 := CASE substr(p_c2, 1, 1)
    WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5
    WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9
    WHEN 'T' THEN 10 WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14
    ELSE 0 END;

  IF v_r1 < 2 OR v_r2 < 2 THEN
    RETURN 0.30;
  END IF;

  v_s1 := substr(p_c1, 2, 1);
  v_s2 := substr(p_c2, 2, 1);
  v_hi := greatest(v_r1, v_r2);
  v_lo := least(v_r1, v_r2);

  -- Base pela carta alta (Chen Formula)
  v_base := CASE v_hi
    WHEN 14 THEN 10.0
    WHEN 13 THEN 8.0
    WHEN 12 THEN 7.0
    WHEN 11 THEN 6.0
    ELSE v_hi / 2.0
  END;

  IF v_hi = v_lo THEN
    v_score := greatest(5.0, v_base * 2.0);
  ELSE
    v_score := v_base;
    IF v_s1 = v_s2 THEN
      v_score := v_score + 2.0;
    END IF;
    v_gap := v_hi - v_lo - 1;
    IF v_gap = 1 THEN
      v_score := v_score - 1.0;
    ELSIF v_gap = 2 THEN
      v_score := v_score - 2.0;
    ELSIF v_gap = 3 THEN
      v_score := v_score - 4.0;
    ELSIF v_gap >= 4 THEN
      v_score := v_score - 5.0;
    END IF;
    IF v_gap <= 1 AND v_hi < 12 THEN
      v_score := v_score + 1.0;
    END IF;
  END IF;

  -- Normaliza aproximadamente de [-1..20] para [0.05..1.0]
  RETURN least(1.0, greatest(0.05, round(((v_score + 1.0) / 21.0)::numeric, 4)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bot_tem_draw(p_cartas text[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n int;
  v_i int;
  v_c text;
  v_r int;
  v_s int;
  v_scnt int[] := array[0, 0, 0, 0];
  v_mscnt int[] := array[0, 0, 0, 0];
  v_ranks boolean[] := array_fill(false, array[14]);
  v_mranks boolean[] := array_fill(false, array[14]);
  v_flush_draw boolean := false;
  v_oesd boolean := false;
  v_gutshot boolean := false;
  v_cnt int;
  v_usa_minha boolean;
  v_ini int;
  v_k int;
  v_idx int;
BEGIN
  v_n := coalesce(array_length(p_cartas, 1), 0);
  IF v_n < 5 OR v_n > 6 THEN
    RETURN jsonb_build_object('flush_draw', false, 'oesd', false, 'gutshot', false);
  END IF;

  FOR v_i IN 1..v_n LOOP
    v_c := p_cartas[v_i];
    v_r := CASE substr(v_c, 1, 1)
      WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 WHEN '5' THEN 5
      WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9
      WHEN 'T' THEN 10 WHEN 'J' THEN 11 WHEN 'Q' THEN 12 WHEN 'K' THEN 13 WHEN 'A' THEN 14
      ELSE 0 END;
    v_s := CASE substr(v_c, 2, 1)
      WHEN 's' THEN 1 WHEN 'h' THEN 2 WHEN 'd' THEN 3 WHEN 'c' THEN 4
      ELSE 0 END;
    IF v_r >= 2 AND v_s >= 1 THEN
      v_scnt[v_s] := v_scnt[v_s] + 1;
      v_ranks[v_r] := true;
      IF v_r = 14 THEN v_ranks[1] := true; END IF;
      IF v_i <= 2 THEN
        v_mscnt[v_s] := v_mscnt[v_s] + 1;
        v_mranks[v_r] := true;
        IF v_r = 14 THEN v_mranks[1] := true; END IF;
      END IF;
    END IF;
  END LOOP;

  FOR v_i IN 1..4 LOOP
    IF v_scnt[v_i] = 4 AND v_mscnt[v_i] >= 1 THEN
      v_flush_draw := true;
    END IF;
  END LOOP;

  -- Verifica OESD (4 consecutivas entre 2..14 usando ao menos 1 carta privada)
  FOR v_ini IN 2..10 LOOP
    IF v_ranks[v_ini] AND v_ranks[v_ini + 1] AND v_ranks[v_ini + 2] AND v_ranks[v_ini + 3] THEN
      IF v_mranks[v_ini] OR v_mranks[v_ini + 1] OR v_mranks[v_ini + 2] OR v_mranks[v_ini + 3] THEN
        v_oesd := true;
      END IF;
    END IF;
  END LOOP;

  -- Verifica Gutshot (4 cartas em janela de 5 usando ao menos 1 carta privada)
  IF NOT v_oesd THEN
    FOR v_ini IN 1..10 LOOP
      v_cnt := 0;
      v_usa_minha := false;
      FOR v_k IN 0..4 LOOP
        v_idx := v_ini + v_k;
        IF v_ranks[v_idx] THEN
          v_cnt := v_cnt + 1;
          IF v_mranks[v_idx] THEN v_usa_minha := true; END IF;
        END IF;
      END LOOP;
      IF v_cnt = 4 AND v_usa_minha THEN
        v_gutshot := true;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'flush_draw', v_flush_draw,
    'oesd', v_oesd,
    'gutshot', v_gutshot
  );
END;
$function$;

-- Passo 4: RPC bot_agir_online - decide e executa a ação do bot da vez
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

  -- Normalização e proteção contra valores inválidos em jogar()
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

GRANT EXECUTE ON FUNCTION public.bot_agir_online(uuid) TO anon, authenticated;

-- Passo 5: RPC bot_confirmar_online - confirma bots somente após todos os humanos elegíveis confirmarem
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

  SELECT count(*) INTO v_bots_pendentes
  FROM public.jogadores
  WHERE partida_id = v_p.id
    AND eh_bot = true
    AND saldo > 0
    AND NOT ausente
    AND NOT confirmado;

  IF v_bots_pendentes = 0 THEN
    RETURN public.estado_mesa(p_partida);
  END IF;

  SELECT count(*) INTO v_humanos_pendentes
  FROM public.jogadores
  WHERE partida_id = v_p.id
    AND eh_bot = false
    AND saldo > 0
    AND NOT ausente
    AND NOT confirmado;

  IF v_humanos_pendentes > 0 THEN
    RETURN public.estado_mesa(p_partida);
  END IF;

  UPDATE public.jogadores
  SET confirmado = true,
      ausente = false
  WHERE partida_id = v_p.id
    AND eh_bot = true
    AND saldo > 0
    AND NOT ausente
    AND NOT confirmado;

  SELECT count(*), count(*) filter (where confirmado)
    INTO v_elegiveis, v_confirmados
  FROM public.jogadores
  WHERE partida_id = v_p.id AND saldo > 0 AND NOT ausente;

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

GRANT EXECUTE ON FUNCTION public.bot_confirmar_online(uuid) TO anon, authenticated;
