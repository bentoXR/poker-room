-- Estatísticas de perfil público: mãos vencidas e tempo de jogo (criada_em)

ALTER TABLE public.contas
  ADD COLUMN IF NOT EXISTS maos_vencidas integer NOT NULL DEFAULT 0;

-- Trigger para contar mãos vencidas automaticamente no modo Online (ultimo_resultado)
CREATE OR REPLACE FUNCTION public.trg_contar_maos_vencidas_online()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vencedores uuid[];
BEGIN
  IF NEW.dev OR NEW.ultimo_resultado IS NULL OR NEW.ultimo_resultado IS NOT DISTINCT FROM OLD.ultimo_resultado THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(array_agg(DISTINCT x.id), ARRAY[]::uuid[])
  INTO v_vencedores
  FROM (
    SELECT nullif(NEW.ultimo_resultado->>'vencedor_id', '')::uuid AS id
    WHERE nullif(NEW.ultimo_resultado->>'vencedor_id', '') IS NOT NULL
    UNION
    SELECT nullif(v->>'id', '')::uuid AS id
    FROM jsonb_array_elements(coalesce(NEW.ultimo_resultado->'potes', '[]'::jsonb)) p,
         jsonb_array_elements(coalesce(p->'vencedores', '[]'::jsonb)) v
    WHERE nullif(v->>'id', '') IS NOT NULL
  ) x;

  IF array_length(v_vencedores, 1) > 0 THEN
    UPDATE public.contas c
    SET maos_vencidas = c.maos_vencidas + 1
    WHERE c.id IN (
      SELECT DISTINCT j.conta_id
      FROM public.jogadores j
      WHERE j.partida_id = NEW.id
        AND j.id = ANY(v_vencedores)
        AND j.conta_id IS NOT NULL
        AND NOT j.eh_bot
    );
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_partidas_maos_vencidas'
      AND tgrelid = 'public.partidas'::regclass
  ) THEN
    CREATE TRIGGER trg_partidas_maos_vencidas
      AFTER UPDATE OF ultimo_resultado ON public.partidas
      FOR EACH ROW
      EXECUTE FUNCTION public.trg_contar_maos_vencidas_online();
  END IF;
END $$;

-- Atualizar distribuir_pote (modo presencial) para incrementar maos_vencidas
CREATE OR REPLACE FUNCTION public.distribuir_pote(p_jogador uuid, p_segredo uuid, p_premios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_j        jogadores;
  v_p        partidas;
  v_item     jsonb;
  v_id       uuid;
  v_valor    int;
  v_total    int := 0;
  v_nome     text;
  v_conta_id uuid;
  v_detalhe  text;
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
      returning nome, conta_id into v_nome, v_conta_id;

      if not v_p.dev and v_conta_id is not null then
        update contas set maos_vencidas = maos_vencidas + 1 where id = v_conta_id;
      end if;

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

-- Atualizar obter_perfil_publico para incluir criada_em e maos_vencidas
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
    'criada_em', v_alvo.criada_em,
    'maos_vencidas', v_alvo.maos_vencidas,
    'online', v_online,
    'status_presenca', v_status,
    'ultimo_acesso', v_alvo.ultimo_acesso,
    'partida_atual', v_partida,
    'relacao', v_relacao,
    'amizade_id', v_amizade_id
  );
END;
$function$;
