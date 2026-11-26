-- Regras de 1 partida por vez, AFK (30s/3 mãos), desconexão (60s), saída com Fold automático e placar R$ para quem saiu

-- 1. Colunas extras em fichas_guardadas e jogadores
ALTER TABLE public.fichas_guardadas
  ADD COLUMN IF NOT EXISTS nome text,
  ADD COLUMN IF NOT EXISTS total_comprado integer;

ALTER TABLE public.jogadores
  ADD COLUMN IF NOT EXISTS desconexao_registrada boolean NOT NULL DEFAULT false;

-- 2. Atualizar ping_sala (throttle de 10s + limpa desconexao_registrada ao reconectar)
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
  WHERE public.presenca.ultimo_sinal < now() - interval '10 seconds';

  UPDATE public.jogadores
  SET desconexao_registrada = false
  WHERE id = p_jogador AND desconexao_registrada;
END;
$function$;

-- 3. Helper interno para saída/remoção segura (aplica Fold se estiver em mão ativa, preserva pote, salva saldo e R$)
CREATE OR REPLACE FUNCTION public._sair_jogador_interno(
  p_partida_id uuid,
  p_jogador_id uuid,
  p_motivo text DEFAULT 'saiu'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p         public.partidas;
  v_j         public.jogadores;
  v_seg       uuid;
  v_ativos    int;
  v_vencedor  public.jogadores;
  v_prox_id   uuid;
  v_humanos   int;
  v_fold_ok   boolean := false;
BEGIN
  SELECT * INTO v_p FROM public.partidas WHERE id = p_partida_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_j FROM public.jogadores WHERE id = p_jogador_id AND partida_id = p_partida_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT v_p.solo_bots
     AND v_p.modo = 'online'
     AND v_p.iniciada
     AND NOT v_p.aguardando_proxima_mao
     AND NOT v_j.desistiu
     AND NOT v_j.esperando
     AND v_j.tem_cartas THEN

    SELECT s.segredo INTO v_seg FROM public.segredos s WHERE s.jogador_id = v_j.id;

    IF v_p.vez_jogador_id = v_j.id AND coalesce(v_p.fase_blind, 0) = 0 AND v_seg IS NOT NULL THEN
      BEGIN
        PERFORM public.jogar(v_j.id, v_seg, 'desistir', 0);
        v_fold_ok := true;
      EXCEPTION WHEN OTHERS THEN
        v_fold_ok := false;
      END;
    END IF;

    IF NOT v_fold_ok THEN
      UPDATE public.jogadores SET desistiu = true WHERE id = v_j.id;

      SELECT count(*) INTO v_ativos
      FROM public.jogadores
      WHERE partida_id = v_p.id
        AND NOT desistiu
        AND NOT esperando
        AND tem_cartas;

      IF v_ativos = 1 THEN
        SELECT * INTO v_vencedor
        FROM public.jogadores
        WHERE partida_id = v_p.id
          AND NOT desistiu
          AND NOT esperando
          AND tem_cartas
        LIMIT 1;

        IF FOUND THEN
          UPDATE public.jogadores
          SET saldo = saldo + v_p.pote
          WHERE id = v_vencedor.id;

          PERFORM public.registrar(
            v_p.id,
            v_vencedor.nome || ' ganhou ' || v_p.pote || ' (abandono do oponente)',
            'pote'
          );

          UPDATE public.partidas
          SET ultimo_resultado = jsonb_build_object(
                'tipo', 'fold',
                'vencedor_id', v_vencedor.id,
                'vencedor_nome', v_vencedor.nome,
                'valor', v_p.pote
              ),
              pote = 0,
              aguardando_proxima_mao = true,
              vez_jogador_id = null,
              fase = 0,
              aposta_atual = 0,
              fase_blind = 0,
              mao = v_p.mao + 1,
              proxima_mao_em = now() + interval '6 seconds'
          WHERE id = v_p.id;
        END IF;
      END IF;
    END IF;

    SELECT * INTO v_j FROM public.jogadores WHERE id = p_jogador_id;
    PERFORM public.registrar(
      v_p.id,
      '🚪 ' || v_j.nome || ' abandonou a partida durante a mão (Fold · fichas guardadas: ' || v_j.saldo || ')'
    );
  ELSE
    IF p_motivo = 'desconectado' THEN
      PERFORM public.registrar(
        v_p.id,
        '📡 ' || v_j.nome || ' foi removido por desconexão (>60s · fichas guardadas: ' || v_j.saldo || ')'
      );
    ELSE
      PERFORM public.registrar(
        v_p.id,
        v_j.nome || ' saiu da sala (fichas guardadas: ' || v_j.saldo || ')'
      );
    END IF;
  END IF;

  IF v_j.conta_id IS NOT NULL THEN
    INSERT INTO public.fichas_guardadas (partida_id, conta_id, saldo, nome, total_comprado)
    VALUES (v_p.id, v_j.conta_id, v_j.saldo, v_j.nome, coalesce(v_j.total_comprado, v_p.saldo_inicial))
    ON CONFLICT (partida_id, conta_id) DO UPDATE
      SET saldo = excluded.saldo,
          nome = excluded.nome,
          total_comprado = excluded.total_comprado;
  END IF;

  IF v_j.criador THEN
    SELECT id INTO v_prox_id
    FROM public.jogadores
    WHERE partida_id = v_p.id AND id <> v_j.id
    ORDER BY ordem
    LIMIT 1;

    IF v_prox_id IS NOT NULL THEN
      UPDATE public.jogadores SET criador = true WHERE id = v_prox_id;
    END IF;
  END IF;

  PERFORM public.tirar_jogador_da_partida(v_p.id, v_j.id);

  IF v_p.modo = 'online' THEN
    SELECT count(*) INTO v_humanos FROM public.jogadores WHERE partida_id = v_p.id AND NOT eh_bot;
    IF v_humanos = 0 OR v_p.solo_bots THEN
      UPDATE public.partidas SET encerrada = true WHERE id = v_p.id;
    ELSE
      UPDATE public.partidas SET versao = versao WHERE id = v_p.id;
    END IF;
  ELSE
    UPDATE public.partidas SET versao = versao WHERE id = v_p.id;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public._sair_jogador_interno(uuid, uuid, text) TO anon, authenticated;

-- 4. Atualizar sair_da_sala (online permite sair na mão via _sair_jogador_interno)
CREATE OR REPLACE FUNCTION public.sair_da_sala(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j public.jogadores;
  v_p public.partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  select * into v_p from partidas where id = v_j.partida_id for update;

  if v_p.modo = 'online' then
    perform public._sair_jogador_interno(v_p.id, v_j.id, 'saiu');
    return estado_mesa(v_p.id);
  end if;

  if v_j.criador then
    raise exception 'O criador não pode sair da sala. Só pode encerrá-la.';
  end if;
  if v_p.iniciada and not v_p.aguardando_proxima_mao then
    raise exception 'Você só pode sair entre as mãos.';
  end if;

  if v_j.conta_id is not null then
    insert into fichas_guardadas (partida_id, conta_id, saldo, nome, total_comprado)
    values (v_p.id, v_j.conta_id, v_j.saldo, v_j.nome, coalesce(v_j.total_comprado, v_p.saldo_inicial))
    on conflict (partida_id, conta_id) do update
      set saldo = excluded.saldo,
          nome = excluded.nome,
          total_comprado = excluded.total_comprado;
  end if;

  perform registrar(v_p.id, v_j.nome || ' saiu da sala (fichas guardadas: ' || v_j.saldo || ')');
  perform tirar_jogador_da_partida(v_p.id, v_j.id);
  update partidas set versao = versao where id = v_p.id;

  return estado_mesa(v_p.id);
end;
$function$;

-- 5. Atualizar expulsar_jogadores_inativos para preservar nome e total_comprado em fichas_guardadas
CREATE OR REPLACE FUNCTION public.expulsar_jogadores_inativos(p_partida_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j        jogadores;
  v_prox_id  uuid;
  v_expulsos int := 0;
  v_restam   int;
  v_modo     text;
  v_ini      int;
begin
  select modo, saldo_inicial into v_modo, v_ini from partidas where id = p_partida_id;
  if not found then
    return 0;
  end if;

  for v_j in
    select *
    from jogadores
    where partida_id = p_partida_id
      and maos_inativo >= 3
    order by ordem
  loop
    if v_j.conta_id is not null then
      insert into fichas_guardadas (partida_id, conta_id, saldo, nome, total_comprado)
      values (p_partida_id, v_j.conta_id, v_j.saldo, v_j.nome, coalesce(v_j.total_comprado, v_ini))
      on conflict (partida_id, conta_id) do update
        set saldo = excluded.saldo,
            nome = excluded.nome,
            total_comprado = excluded.total_comprado;
    end if;

    if v_j.criador then
      select id into v_prox_id
      from jogadores
      where partida_id = p_partida_id and id <> v_j.id
      order by ordem
      limit 1;

      if v_prox_id is not null then
        update jogadores set criador = true where id = v_prox_id;
      end if;
    end if;

    perform registrar(
      p_partida_id,
      case when v_j.maos_inativo >= 99
        then '🚫 ' || v_j.nome || ' foi removido por votação (fichas guardadas: ' || v_j.saldo || ')'
        else v_j.nome || ' foi expulso por inatividade (3 mãos sem jogar · fichas salvas: ' || v_j.saldo || ')'
      end
    );
    perform tirar_jogador_da_partida(p_partida_id, v_j.id);
    v_expulsos := v_expulsos + 1;
  end loop;

  if v_expulsos > 0 then
    select count(*) into v_restam from jogadores where partida_id = p_partida_id;
    if v_modo = 'online' and v_restam = 0 then
      update partidas set encerrada = true where id = p_partida_id;
    else
      update partidas set versao = versao where id = p_partida_id;
    end if;
  end if;

  return v_expulsos;
end;
$function$;

-- 6. Atualizar avancar_tempo_online (desconexão >60s + ações automáticas + remoção)
CREATE OR REPLACE FUNCTION public.avancar_tempo_online(p_partida uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_p           partidas;
  v_j           jogadores;
  v_desc        jogadores;
  v_seg         uuid;
  v_acao        text;
  v_confirmados int;
  v_p_apos      partidas;
  v_mudou       boolean := false;
  v_vez_desc    boolean := false;
begin
  select * into v_p from partidas where id = p_partida;
  if not found or v_p.modo <> 'online' or v_p.encerrada then
    return jsonb_build_object('sem_mudanca', true);
  end if;

  if not (
    (v_p.votacao is not null and (v_p.votacao->>'expira_em')::timestamptz <= now())
    or (not v_p.pausada and v_p.aguardando_proxima_mao
        and exists (select 1 from jogadores where partida_id = v_p.id and maos_inativo >= 3))
    or (not v_p.pausada and not v_p.solo_bots
        and exists (
          select 1 from jogadores j
          left join presenca pr on pr.jogador_id = j.id
          where j.partida_id = v_p.id
            and not j.eh_bot
            and coalesce(pr.ultimo_sinal, j.criado_em) < now() - interval '60 seconds'
        ))
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

  -- Detecta e registra desconexões (>60s sem sinal)
  if not v_p.solo_bots then
    for v_desc in
      select j.*
      from jogadores j
      left join presenca pr on pr.jogador_id = j.id
      where j.partida_id = v_p.id
        and not j.eh_bot
        and coalesce(pr.ultimo_sinal, j.criado_em) < now() - interval '60 seconds'
      order by j.ordem
    loop
      if not v_desc.desconexao_registrada then
        update jogadores
        set desconexao_registrada = true,
            ausente = true
        where id = v_desc.id;
        perform registrar(v_p.id, '📡 ' || v_desc.nome || ' desconectou da partida.');
        v_mudou := true;
      end if;

      -- Se não está em mão ativa (ou já desistiu/esperando), remove da mesa após >60s desconectado
      if not v_p.iniciada or v_p.aguardando_proxima_mao or v_desc.desistiu or v_desc.esperando or not v_desc.tem_cartas then
        perform public._sair_jogador_interno(v_p.id, v_desc.id, 'desconectado');
        v_mudou := true;
      end if;
    end loop;
  end if;

  select * into v_p from partidas where id = p_partida;
  if v_p.encerrada then
    return estado_mesa(v_p.id);
  end if;

  if v_p.aguardando_proxima_mao
     and exists (select 1 from jogadores where partida_id = v_p.id and maos_inativo >= 3) then
    if expulsar_jogadores_inativos(v_p.id) > 0 then
      v_mudou := true;
    end if;
  end if;

  -- Verifica se o jogador da vez está desconectado (>60s) ou com tempo expirado
  if v_p.iniciada and not v_p.aguardando_proxima_mao and v_p.fase < 4 and v_p.vez_jogador_id is not null then
    if not v_p.solo_bots then
      select exists (
        select 1
        from jogadores j
        left join presenca pr on pr.jogador_id = j.id
        where j.id = v_p.vez_jogador_id
          and not j.eh_bot
          and coalesce(pr.ultimo_sinal, j.criado_em) < now() - interval '60 seconds'
      ) into v_vez_desc;
    end if;

    if v_vez_desc or (
      coalesce(v_p.tempo_turno, 0) > 0
      and v_p.vez_desde is not null
      and now() >= v_p.vez_desde + make_interval(secs => v_p.tempo_turno)
    ) then
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
          set texto = texto || case when v_vez_desc then ' (desconectado)' else ' (tempo esgotado)' end
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

        -- Se desconectou e levou Fold (ou a mão terminou), remove da mesa
        select * into v_j from jogadores where id = v_j.id;
        select * into v_p_apos from partidas where id = v_p.id;
        if v_vez_desc and found and (v_j.desistiu or v_p_apos.aguardando_proxima_mao) then
          perform public._sair_jogador_interno(v_p.id, v_j.id, 'desconectado');
        elsif v_p_apos.aguardando_proxima_mao then
          perform expulsar_jogadores_inativos(v_p.id);
        end if;

        return estado_mesa(v_p.id);
      end if;
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

-- 7. RPCs para 1 partida por vez
CREATE OR REPLACE FUNCTION public.obter_partida_ativa_conta(
  p_conta uuid,
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  SELECT jsonb_build_object(
    'partida_id', p.id,
    'nome', coalesce(nullif(trim(p.nome), ''), 'Sala ' || p.codigo),
    'modo', p.modo,
    'em_mao_ativa', (
      p.modo = 'online'
      AND p.iniciada
      AND NOT p.aguardando_proxima_mao
      AND NOT j.desistiu
      AND NOT j.esperando
      AND j.tem_cartas
    )
  ) INTO v_res
  FROM public.jogadores j
  JOIN public.partidas p ON p.id = j.partida_id
  WHERE j.conta_id = p_conta
    AND NOT p.encerrada
    AND NOT p.dev
  ORDER BY j.criado_em DESC
  LIMIT 1;

  RETURN v_res;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obter_partida_ativa_conta(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sair_de_outras_salas(
  p_conta uuid,
  p_token uuid,
  p_exceto_partida uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec record;
  v_saidas int := 0;
BEGIN
  PERFORM public.conferir_conta(p_conta, p_token);

  FOR v_rec IN
    SELECT j.id AS jogador_id, j.partida_id
    FROM public.jogadores j
    JOIN public.partidas p ON p.id = j.partida_id
    WHERE j.conta_id = p_conta
      AND NOT p.encerrada
      AND NOT p.dev
      AND (p_exceto_partida IS NULL OR p.id <> p_exceto_partida)
  LOOP
    PERFORM public._sair_jogador_interno(v_rec.partida_id, v_rec.jogador_id, 'saiu');
    v_saidas := v_saidas + 1;
  END LOOP;

  RETURN jsonb_build_object('saidas', v_saidas);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sair_de_outras_salas(uuid, uuid, uuid) TO anon, authenticated;

-- 8. Atualizar estado_mesa para expor jogadores que saíram (para cobrança R$)
CREATE OR REPLACE FUNCTION public.estado_mesa(p_partida uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'partida', to_jsonb(p),
    'jogadores', coalesce(
      (select jsonb_agg(
         to_jsonb(j) || jsonb_build_object('avatar_versao', coalesce(c.avatar_versao, 0))
         order by j.ordem
       )
       from public.jogadores j
       left join public.contas c on c.id = j.conta_id
       where j.partida_id = p.id),
      '[]'::jsonb),
    'saidos', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'conta_id', f.conta_id,
         'nome', coalesce(nullif(trim(f.nome), ''), c.nome, 'Jogador'),
         'saldo', f.saldo,
         'total_comprado', coalesce(f.total_comprado, p.saldo_inicial)
       ))
       from public.fichas_guardadas f
       left join public.contas c on c.id = f.conta_id
       where f.partida_id = p.id
         and not exists (
           select 1 from public.jogadores j
           where j.partida_id = p.id and j.conta_id = f.conta_id
         )),
      '[]'::jsonb),
    'historico', coalesce(
      (select jsonb_agg(jsonb_build_object('mao', h.mao, 'texto', h.texto) order by h.id desc)
         from (select id, mao, texto from public.historico
                where partida_id = p.id order by id desc limit 40) h),
      '[]'::jsonb),
    'agora', now()
  )
  from public.partidas p
  where p.id = p_partida;
$function$;
