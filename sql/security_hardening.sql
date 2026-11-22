-- Bloqueia RPCs exclusivos do modo presencial em salas online/blackjack

CREATE OR REPLACE FUNCTION public.abrir_rodada(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if not v_p.aguardando_cartas then
    raise exception 'Não há rodada para abrir agora.';
  end if;

  update partidas set aguardando_cartas = false where id = v_p.id;
  perform registrar(v_p.id, 'Apostas abertas');

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.adicionar_fichas(p_jogador uuid, p_segredo uuid, p_alvo uuid, p_valor integer, p_op uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
  v_a jogadores;
  v_passo int;
  v_novo int;
  v_ins int;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode adicionar fichas.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.iniciada and not v_p.aguardando_proxima_mao then
    raise exception 'Só é possível adicionar fichas entre as mãos.';
  end if;

  select * into v_a from jogadores where id = p_alvo and partida_id = v_p.id;
  if not found then
    raise exception 'Jogador inválido.';
  end if;

  if p_valor is null or p_valor <= 0 then
    raise exception 'Informe uma quantidade de fichas maior que zero.';
  end if;
  if p_valor > 100000000 then
    raise exception 'Quantidade de fichas muito alta.';
  end if;

  v_passo := passo_aposta(v_p.id);
  if v_passo > 1 and p_valor % v_passo <> 0 then
    raise exception 'Nesta sala as fichas devem ser múltiplas de % .', v_passo;
  end if;

  if p_op is not null then
    insert into operacoes_fichas (op, partida_id) values (p_op, v_p.id)
    on conflict (op) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then
      return estado_mesa(v_p.id);
    end if;
  end if;

  update jogadores
  set saldo = saldo + p_valor,
      total_comprado = coalesce(total_comprado, v_p.saldo_inicial) + p_valor
  where id = v_a.id
  returning saldo into v_novo;

  perform registrar(v_p.id,
    'Criador adicionou ' || p_valor || ' fichas a ' || v_a.nome || ' (saldo: ' || v_novo || ')');

  update partidas set versao = versao where id = v_p.id;
  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.alterar_blinds(p_jogador uuid, p_segredo uuid, p_small integer, p_big integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode alterar os blinds.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.iniciada then
    raise exception 'Os blinds só podem ser alterados antes de iniciar a partida.';
  end if;

  if coalesce(p_small, 0) < 1 or coalesce(p_big, 0) < 1
     or p_small > 100000000 or p_big > 100000000 then
    raise exception 'Os blinds precisam ser números maiores que zero.';
  end if;
  if p_big < p_small then
    raise exception 'O big blind não pode ser menor que o small blind.';
  end if;

  update partidas set small_blind = p_small, big_blind = p_big where id = v_p.id;
  perform registrar(v_p.id, 'Blinds ajustados para ' || p_small || ' / ' || p_big);

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.desfazer_jogada(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.vez_jogador_id is distinct from v_j.id then
    raise exception 'Não é a sua vez.';
  end if;
  if not v_p.agiu or v_p.undo_saldo is null then
    raise exception 'Não há jogada para desfazer.';
  end if;

  delete from historico
  where id = (
    select id from historico
    where partida_id = v_p.id and tipo = 'acao'
    order by id desc limit 1
  );

  update jogadores
  set saldo = v_p.undo_saldo,
      apostou = v_p.undo_apostou,
      desistiu = v_p.undo_desistiu
  where id = v_j.id;

  update partidas
  set pote = v_p.undo_pote,
      aposta_atual = v_p.undo_aposta_atual,
      agiu = false,
      undo_saldo = null,
      undo_apostou = null,
      undo_desistiu = null,
      undo_aposta_atual = null,
      undo_pote = null
  where id = v_p.id;

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.distribuir_pote(p_jogador uuid, p_segredo uuid, p_premios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j       jogadores;
  v_p       partidas;
  v_item    jsonb;
  v_id      uuid;
  v_valor   int;
  v_total   int := 0;
  v_nome    text;
  v_detalhe text;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode distribuir o pote.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if not v_p.iniciada then
    raise exception 'A partida ainda não começou.';
  end if;
  if v_p.aguardando_proxima_mao then
    raise exception 'Esta mão já foi encerrada.';
  end if;
  if v_p.fase_blind > 0 then
    raise exception 'Aguarde os blinds serem pagos.';
  end if;
  if v_p.pote <= 0 then
    raise exception 'O pote está vazio.';
  end if;
  if p_premios is null or jsonb_typeof(p_premios) <> 'array' then
    raise exception 'Informe quanto cada jogador recebe.';
  end if;

  for v_item in select * from jsonb_array_elements(p_premios) loop
    v_id := (v_item->>'jogador_id')::uuid;
    v_valor := (v_item->>'valor')::int;
    if v_valor is null or v_valor < 0 then
      raise exception 'Valor inválido.';
    end if;
    if not exists (select 1 from jogadores where id = v_id and partida_id = v_p.id) then
      raise exception 'Jogador inválido.';
    end if;
    v_total := v_total + v_valor;
  end loop;

  if v_total <> v_p.pote then
    raise exception 'A soma (%) precisa ser igual ao pote (%).', v_total, v_p.pote;
  end if;

  for v_item in select * from jsonb_array_elements(p_premios) loop
    v_id := (v_item->>'jogador_id')::uuid;
    v_valor := (v_item->>'valor')::int;
    if v_valor > 0 then
      update jogadores set saldo = saldo + v_valor where id = v_id
      returning nome into v_nome;
      v_detalhe := left(nullif(trim(coalesce(v_item->>'detalhe', '')), ''), 120);
      perform registrar(
        v_p.id,
        v_nome || ' ganhou ' || v_valor || case when v_detalhe is not null then ' (' || v_detalhe || ')' else '' end,
        'pote'
      );
    end if;
  end loop;

  update jogadores set apostou = 0, desistiu = false where partida_id = v_p.id;

  if (select count(*) from jogadores where partida_id = v_p.id and saldo > 0) >= 2 then
    perform registrar(v_p.id, 'Mão ' || v_p.mao || ' terminou. Aguardando o criador iniciar a próxima.');
  else
    perform registrar(v_p.id, 'Fim da partida: só resta um jogador com fichas');
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
  where id = v_p.id;

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.iniciar_partida(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode iniciar a partida.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.iniciada then
    raise exception 'A partida já foi iniciada.';
  end if;
  if (select count(*) from jogadores where partida_id = v_p.id) < 2 then
    raise exception 'São necessários pelo menos 2 jogadores.';
  end if;

  update partidas set iniciada = true, iniciada_em = now() where id = v_p.id;
  perform comecar_mao(v_p.id);
  perform registrar(v_p.id, 'Partida iniciada. Mão ' || v_p.mao || ' começou.');

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.mover_jogador(p_jogador uuid, p_segredo uuid, p_alvo uuid, p_dir integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
  v_a jogadores;
  v_b jogadores;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode organizar os jogadores.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.iniciada then
    raise exception 'A ordem só pode mudar antes de iniciar a partida.';
  end if;

  select * into v_a from jogadores where id = p_alvo and partida_id = v_p.id;
  if not found then
    raise exception 'Jogador inválido.';
  end if;

  if p_dir < 0 then
    select * into v_b from jogadores
    where partida_id = v_p.id and ordem < v_a.ordem order by ordem desc limit 1;
  else
    select * into v_b from jogadores
    where partida_id = v_p.id and ordem > v_a.ordem order by ordem asc limit 1;
  end if;

  if found then
    update jogadores set ordem = v_b.ordem where id = v_a.id;
    update jogadores set ordem = v_a.ordem where id = v_b.id;
  end if;

  update partidas set versao = versao where id = v_p.id;
  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.passar_vez(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j       jogadores;
  v_p       partidas;
  v_proximo uuid;
  v_restam  int;
  v_unico   uuid;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.fase_blind > 0 then
    raise exception 'Os blinds ainda não foram pagos.';
  end if;
  if v_p.vez_jogador_id is distinct from v_j.id then
    raise exception 'Não é a sua vez.';
  end if;
  if not v_p.agiu then
    raise exception 'Faça uma ação antes de passar a vez.';
  end if;

  -- Quem ainda está na mão: não desistiu e tem fichas (ou já apostou nesta mão)
  select count(*), (array_agg(id))[1]
    into v_restam, v_unico
  from jogadores
  where partida_id = v_p.id
    and desistiu = false
    and (saldo > 0 or apostou > 0);

  if v_restam = 1 and v_p.pote > 0 then
    perform premiar_unico(v_p.id, v_unico);
    return estado_mesa(v_p.id);
  end if;

  select j.id into v_proximo
  from jogadores j
  where j.partida_id = v_p.id
    and j.id <> v_j.id
    and j.desistiu = false
    and j.saldo > 0
  order by (j.ordem > v_j.ordem) desc, j.ordem
  limit 1;

  update partidas
  set vez_jogador_id = v_proximo, agiu = false
  where id = v_p.id;

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.proxima_mao(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode começar a próxima mão.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if not v_p.aguardando_proxima_mao then
    raise exception 'Não há mão aguardando para começar.';
  end if;
  if (select count(*) from jogadores where partida_id = v_p.id and saldo > 0) < 2 then
    raise exception 'Só resta um jogador com fichas. A partida acabou.';
  end if;

  -- quem entrou durante a pausa estava marcado como "desistiu": libera todo mundo
  update jogadores set desistiu = false, apostou = 0 where partida_id = v_p.id;
  update partidas set aguardando_proxima_mao = false where id = v_p.id;

  perform comecar_mao(v_p.id);
  perform registrar(v_p.id, 'Mão ' || v_p.mao || ' começou.');

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.remover_jogador(p_jogador uuid, p_segredo uuid, p_alvo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
  v_a jogadores;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode remover jogadores.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.iniciada and not v_p.aguardando_proxima_mao then
    raise exception 'Só é possível remover jogadores entre as mãos.';
  end if;

  select * into v_a from jogadores where id = p_alvo and partida_id = v_p.id;
  if not found then
    raise exception 'Jogador inválido.';
  end if;
  if v_a.criador then
    raise exception 'O criador não pode ser removido.';
  end if;

  perform registrar(v_p.id, v_a.nome || ' foi removido pelo criador (fichas guardadas: ' || v_a.saldo || ')');

  -- guarda as fichas, exatamente como acontece quando o jogador sai sozinho
  if v_a.conta_id is not null then
    insert into fichas_guardadas (partida_id, conta_id, saldo)
    values (v_p.id, v_a.conta_id, v_a.saldo)
    on conflict (partida_id, conta_id) do update set saldo = excluded.saldo;
  end if;
  perform tirar_jogador_da_partida(v_p.id, v_a.id);

  update partidas set versao = versao where id = v_p.id;
  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.resetar_partida(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode resetar a partida.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;

  -- NOVO: quem saiu antes do reset não guarda mais fichas
  delete from fichas_guardadas where partida_id = v_p.id;

  update jogadores
  set saldo = v_p.saldo_inicial, apostou = 0, desistiu = false, falou = false, total_mao = 0
  where partida_id = v_p.id;

  update partidas
  set pote = 0, aposta_atual = 0, agiu = false, iniciada = false,
      vez_jogador_id = null, mao = 1, nivel = 1,
      fase = 0, aguardando_cartas = false, iniciada_em = null, dealer_jogador_id = null,
      fase_blind = 0, sb_jogador_id = null, bb_jogador_id = null, primeiro_jogador_id = null,
      aguardando_proxima_mao = false,   -- NOVO
      undo_saldo = null, undo_apostou = null, undo_desistiu = null,
      undo_aposta_atual = null, undo_pote = null
  where id = v_p.id;

  perform registrar(v_p.id, 'Partida resetada pelo criador');

  return estado_mesa(v_p.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.subir_nivel(p_jogador uuid, p_segredo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j jogadores;
  v_p partidas;
begin
  v_j := conferir_jogador(p_jogador, p_segredo);
  if not v_j.criador then
    raise exception 'Só o criador pode subir o nível.';
  end if;

  select * into v_p from partidas where id = v_j.partida_id for update;
  if v_p.modo <> 'presencial' then
    raise exception 'Esta ação só é permitida no modo presencial.';
  end if;
  if v_p.pote > 0 then
    raise exception 'Só é possível subir o nível com o pote vazio (logo após distribuir o pote).';
  end if;
  if v_p.big_blind * 2 > 100000000 then
    raise exception 'Os blinds já chegaram ao limite.';
  end if;

  update partidas
  set small_blind = small_blind * 2,
      big_blind = big_blind * 2,
      nivel = nivel + 1
  where id = v_p.id;

  perform registrar(
    v_p.id,
    'Nível ' || (v_p.nivel + 1) || ': blinds ' || (v_p.small_blind * 2) || ' / ' || (v_p.big_blind * 2)
  );

  return estado_mesa(v_p.id);
end;
$function$;

