-- Execute no SQL Editor do Supabase caso entrar_sala / sair_da_sala ainda não tenham o limite de 6 jogadores e trava de saída em rodada de Blackjack.

CREATE OR REPLACE FUNCTION public.entrar_sala(p_conta uuid, p_token uuid, p_partida_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_nome     text;
  v_j        jogadores;
  v_seg      uuid;
  v_res      jsonb;
  v_guardado int;
  v_modo     text;
  v_qtd      int;
begin
  v_nome := conferir_conta(p_conta, p_token);

  select modo into v_modo from partidas where id = p_partida_id and not encerrada;
  if not found then
    raise exception 'Essa sala não existe mais.';
  end if;

  perform pg_advisory_xact_lock(hashtext('poker-sala-' || p_partida_id::text));

  select * into v_j
  from jogadores
  where partida_id = p_partida_id and conta_id = p_conta;

  if found then
    select s.segredo into v_seg from segredos s where s.jogador_id = v_j.id;
    if v_seg is null then
      raise exception 'Não consegui recuperar o seu jogador nesta sala.';
    end if;
    return jsonb_build_object(
      'jogador_id', v_j.id,
      'segredo', v_seg,
      'reconectado', true
    );
  end if;

  if v_modo = 'blackjack' then
    select count(*) into v_qtd from jogadores where partida_id = p_partida_id;
    if v_qtd >= 6 then
      raise exception 'Esta mesa de Blackjack já está cheia (máx. 6 jogadores).';
    end if;
  end if;

  v_res := public.entrar_partida(p_partida_id, v_nome)::jsonb;

  update jogadores
  set conta_id = p_conta
  where id = (v_res->>'jogador_id')::uuid;

  select f.saldo into v_guardado
  from fichas_guardadas f
  where f.partida_id = p_partida_id and f.conta_id = p_conta;

  if found then
    update jogadores
    set saldo = v_guardado
    where id = (v_res->>'jogador_id')::uuid;

    delete from fichas_guardadas
    where partida_id = p_partida_id and conta_id = p_conta;

    perform registrar(p_partida_id, v_nome || ' voltou com ' || v_guardado || ' fichas');
    update partidas set versao = versao where id = p_partida_id;
  end if;

  if exists (select 1 from partidas where id = p_partida_id and iniciada) then
    update jogadores
    set esperando = true, desistiu = true
    where id = (v_res->>'jogador_id')::uuid;

    perform registrar(p_partida_id, v_nome || ' entrou e espera a próxima mão');
    update partidas set versao = versao where id = p_partida_id;
  end if;

  return v_res || jsonb_build_object('reconectado', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sair_da_sala(p_jogador uuid, p_segredo uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_j      jogadores;
  v_p      partidas;
  v_restam int;
  v_bj_jog boolean := false;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  select * into v_p from partidas where id = v_j.partida_id for update;

  if v_p.modo = 'blackjack' then
    if coalesce(v_p.blackjack_estado->>'fase', '') = 'jogando' then
      select exists (
        select 1
        from jsonb_array_elements(coalesce(v_p.blackjack_estado->'maos'->(v_j.id::text)->'lista', '[]'::jsonb)) elem
        where elem->>'status' in ('jogando', 'parou', 'dobrou')
      ) into v_bj_jog;
      if v_bj_jog then
        raise exception 'Aguarde o fim desta rodada de Blackjack para sair da mesa.';
      end if;
    end if;
  elsif v_p.modo = 'online' then
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

  if v_p.modo in ('online', 'blackjack') then
    select count(*) into v_restam from jogadores where partida_id = v_p.id;
    if v_restam = 0 then
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
