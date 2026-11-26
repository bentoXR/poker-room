-- Atualiza a lista de nomes aleatórios dos bots em adicionar_bot_sala (130 nomes)
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
    'KauanX', 'LuanPlay', 'Pedrin77', 'ViniStorm', 'GuiNinja', 'MatheusBR', 'RafinhaX', 'BielGamer', 'JuninFPS', 'DuduKing',
    'LucasZin', 'FelipeRush', 'CaioNXT', 'RenanPlay', 'GustavoX', 'NandoBR', 'Teteu77', 'VitinPro', 'Brunex', 'LeozinFPS',
    'Migzito', 'ArthurPlay', 'EnzoRush', 'PaulinX', 'DiegoBR', 'SamuelZ', 'AlefGamer', 'Nicolas77', 'HeitorX', 'DaniloPlay',
    'JotapeBR', 'Kauazin', 'RuanFPS', 'MarquinhosX', 'Luquinhas', 'PedroNXT', 'CaduPlay', 'WesleyBR', 'JuninhoX', 'GabrielRush',
    'Bielzin', 'LipeGamer', 'Thiaguin', 'VitorZ', 'Andrezin77', 'RickBR', 'OtavioX', 'YagoPlay', 'BreninFPS', 'GuiiZin',
    'MarcosNXT', 'AlemaoBR', 'JoaoRush', 'Kevinzera', 'Luanzin77', 'RobinhoX', 'FredPlay', 'MuriloBR', 'DanzinFPS', 'IgorNXT',
    'Peuzin', 'TavinPlay', 'RiqueX', 'JhonBR', 'Rafex77', 'ViniNXT', 'LorranX', 'KauanRush', 'BinhoPlay', 'MateusZin',
    'AnaFlix', 'LariX', 'BiaPlay', 'Malu77', 'DudaGamer', 'NinaFPS', 'Luhzinha', 'MihX', 'CarolBR', 'JuhPlay',
    'GabiNXT', 'Lele77', 'IsaStorm', 'ManuX', 'SosoPlay', 'ClaraBR', 'LiviaGamer', 'MajuFPS', 'BebelX', 'Yasmin77',
    'ShadowHunter', 'DarkWolf', 'SilentStorm', 'FrostByte', 'NightRider', 'QuickShot', 'IronClaw', 'BluePhantom', 'GhostRunner', 'FireStrike',
    'LuckyAce', 'ThunderX', 'ZeroGravity', 'WildFox', 'ColdBlood', 'PixelKnight', 'StormBreaker', 'BlackArrow', 'RapidFire', 'SkyWalker',
    'LunaStar', 'PinkShadow', 'SweetVenom', 'QueenVibe', 'StarGirl', 'MoonLight', 'CherryFox', 'BellaStorm', 'DollFace', 'AngelRush',
    'ElMatador', 'LoboNegro', 'RayoAzul', 'FuegoX', 'SombraReal', 'ChicoPro', 'ToroBravo', 'ReyDelJuego', 'GatoFeroz', 'DragonRojo'
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
