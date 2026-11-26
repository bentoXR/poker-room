-- Ajustes nos bots e votações:
-- 1) Diminui a chance dos bots desistirem antes do flop (fase = 0) nos 3 níveis
-- 2) Votações (iniciar_votacao_online e votar_sala_online) contam apenas jogadores reais (NOT eh_bot AND NOT espectando)

CREATE OR REPLACE FUNCTION public.iniciar_votacao_online(
  p_jogador uuid,
  p_segredo uuid,
  p_tipo text,
  p_alvo uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_j           jogadores;
  v_p           partidas;
  v_a           jogadores;
  v_elegiveis   int;
  v_total_mesa  int;
  v_necessarios int;
  v_votos       jsonb;
  v_votacao     jsonb;
  v_desc        text;
  v_agora       timestamptz := now();
BEGIN
  v_j := conferir_jogador(p_jogador, p_segredo);

  SELECT * INTO v_p FROM partidas WHERE id = v_j.partida_id FOR UPDATE;
  IF NOT found OR v_p.modo <> 'online' OR v_p.encerrada THEN
    RAISE EXCEPTION 'Votação disponível apenas em mesas online ativas.';
  END IF;

  IF v_p.votacao IS NOT NULL AND (v_p.votacao->>'expira_em')::timestamptz > v_agora THEN
    RAISE EXCEPTION 'Já existe uma votação em andamento.';
  END IF;

  SELECT
    count(*) FILTER (WHERE NOT eh_bot AND NOT espectando),
    count(*) FILTER (WHERE NOT espectando)
  INTO v_elegiveis, v_total_mesa
  FROM jogadores
  WHERE partida_id = v_p.id;

  v_elegiveis := greatest(1, v_elegiveis);

  IF p_tipo = 'pausar' THEN
    IF v_p.pausada THEN
      RAISE EXCEPTION 'A mesa já está pausada.';
    END IF;
    v_desc := 'pausar a mesa';

  ELSIF p_tipo = 'retomar' THEN
    IF NOT v_p.pausada THEN
      RAISE EXCEPTION 'A mesa não está pausada.';
    END IF;
    v_desc := 'retomar a mesa';

  ELSIF p_tipo = 'rabbit_on' THEN
    IF v_p.rabbit_hunt_ativo THEN
      RAISE EXCEPTION 'O Rabbit Hunt já está ativado nesta mesa.';
    END IF;
    v_desc := 'ativar ver cartas do coelhinho (Rabbit Hunt)';

  ELSIF p_tipo = 'rabbit_off' THEN
    IF NOT v_p.rabbit_hunt_ativo THEN
      RAISE EXCEPTION 'O Rabbit Hunt já está desativado nesta mesa.';
    END IF;
    v_desc := 'desativar ver cartas do coelhinho (Rabbit Hunt)';

  ELSIF p_tipo = 'expulsar' THEN
    IF v_total_mesa < 3 THEN
      RAISE EXCEPTION 'São necessários pelo menos 3 jogadores na mesa para votar uma remoção.';
    END IF;
    IF p_alvo IS NULL OR p_alvo = v_j.id THEN
      RAISE EXCEPTION 'Escolha outro jogador para votar a remoção.';
    END IF;
    SELECT * INTO v_a FROM jogadores WHERE id = p_alvo AND partida_id = v_p.id;
    IF NOT found THEN
      RAISE EXCEPTION 'Jogador não encontrado nesta mesa.';
    END IF;
    v_desc := 'remover ' || v_a.nome;

  ELSE
    RAISE EXCEPTION 'Tipo de votação inválido.';
  END IF;

  v_necessarios := (v_elegiveis / 2) + 1;
  v_votos := jsonb_build_object(v_j.id::text, true);

  v_votacao := jsonb_build_object(
    'id', gen_random_uuid(),
    'tipo', p_tipo,
    'alvo_id', CASE WHEN p_tipo = 'expulsar' THEN v_a.id ELSE NULL END,
    'alvo_nome', CASE WHEN p_tipo = 'expulsar' THEN v_a.nome ELSE NULL END,
    'autor_id', v_j.id,
    'autor_nome', v_j.nome,
    'criada_em', v_agora,
    'expira_em', v_agora + interval '60 seconds',
    'necessarios', v_necessarios,
    'elegiveis', v_elegiveis,
    'sim', 1,
    'nao', 0,
    'votos', v_votos
  );

  PERFORM registrar(v_p.id, '🗳 ' || v_j.nome || ' abriu votação para ' || v_desc || ' (1/' || v_necessarios || ')');

  IF 1 >= v_necessarios THEN
    PERFORM aplicar_votacao_aprovada(v_p.id, v_votacao);
  ELSE
    UPDATE partidas SET votacao = v_votacao WHERE id = v_p.id;
  END IF;

  RETURN estado_mesa(v_p.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.votar_sala_online(
  p_jogador uuid,
  p_segredo uuid,
  p_voto boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_j           jogadores;
  v_p           partidas;
  v_votos       jsonb;
  v_elegiveis   int;
  v_necessarios int;
  v_sim         int;
  v_nao         int;
  v_votacao     jsonb;
  v_agora       timestamptz := now();
begin
  v_j := conferir_jogador(p_jogador, p_segredo);

  select * into v_p from partidas where id = v_j.partida_id for update;
  if not found or v_p.modo <> 'online' or v_p.encerrada then
    raise exception 'Votação disponível apenas em mesas online ativas.';
  end if;

  if v_p.votacao is null then
    raise exception 'Não há votação ativa no momento.';
  end if;

  if (v_p.votacao->>'expira_em')::timestamptz <= v_agora then
    update partidas set votacao = null where id = v_p.id;
    perform registrar(v_p.id, '⌛ Votação encerrada sem maioria.');
    return estado_mesa(v_p.id);
  end if;

  v_votos := coalesce(v_p.votacao->'votos', '{}'::jsonb);
  v_votos := jsonb_set(v_votos, array[v_j.id::text], to_jsonb(coalesce(p_voto, false)), true);

  select count(*) into v_elegiveis
  from jogadores
  where partida_id = v_p.id and not eh_bot and not espectando;

  v_elegiveis := greatest(1, v_elegiveis);
  v_necessarios := (v_elegiveis / 2) + 1;

  select
    count(*) filter (where (e.value)::boolean = true),
    count(*) filter (where (e.value)::boolean = false)
  into v_sim, v_nao
  from jsonb_each_text(v_votos) e
  join jogadores j on j.id::text = e.key
    and j.partida_id = v_p.id
    and not j.eh_bot
    and not j.espectando;

  v_votacao := v_p.votacao
    || jsonb_build_object(
      'votos', v_votos,
      'elegiveis', v_elegiveis,
      'necessarios', v_necessarios,
      'sim', v_sim,
      'nao', v_nao
    );

  if v_sim >= v_necessarios then
    perform aplicar_votacao_aprovada(v_p.id, v_votacao);
  elsif v_nao > (v_elegiveis - v_necessarios) then
    update partidas set votacao = null where id = v_p.id;
    perform registrar(v_p.id, '❌ Votação rejeitada pela maioria (' || v_sim || ' sim, ' || v_nao || ' não).');
  else
    update partidas set votacao = v_votacao where id = v_p.id;
  end if;

  return estado_mesa(v_p.id);
end;
$function$;

-- Atualiza bot_agir_online reduzindo a chance de desistência pré-flop nos 3 níveis
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
        IF v_falta <= v_bb * 6 OR v_eff >= 0.10 OR v_falta <= (v_bot.saldo * 0.65) OR v_rng < 0.50 THEN
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
          IF v_eff >= 0.10 OR v_rng < 0.78 THEN
            v_acao := 'pagar';
          ELSE
            v_acao := 'desistir';
          END IF;
        ELSIF v_falta <= v_bb * 4 THEN
          IF v_eff >= 0.16 OR (v_eff >= 0.10 AND v_rng < 0.65) THEN
            v_acao := 'pagar';
          ELSE
            v_acao := 'desistir';
          END IF;
        ELSIF v_eff >= least(0.55, 0.22 + (v_falta::numeric / greatest(1, v_bot.saldo)) * 0.42) THEN
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
        ELSIF v_falta <= v_bb AND (v_eff >= 0.16 OR v_rng < 0.60) THEN
          v_acao := 'pagar';
        ELSIF v_eff >= least(0.66, 0.24 + v_pot_odds * 0.60) THEN
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
