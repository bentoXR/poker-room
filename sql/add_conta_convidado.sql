-- Suporte a conta convidado (Guest) sem login/cadastro obrigatório
ALTER TABLE public.contas
  ADD COLUMN IF NOT EXISTS convidado boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.criar_conta_convidado(p_nome text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_base text := left(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 10);
  v_nome text;
  v_tent int := 0;
  v_c    public.contas;
begin
  if length(v_base) >= 2 and v_base !~ '[\x00-\x1F\x7F]' and v_base ~ '^[[:alnum:]À-ÿ _.-]+$' then
    if not exists (
      select 1 from public.contas
      where lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower(v_base)
    ) then
      v_nome := v_base;
    else
      v_base := left(regexp_replace(v_base, '\s+', '', 'g'), 6);
    end if;
  else
    v_base := 'Guest';
  end if;

  while v_nome is null loop
    v_tent := v_tent + 1;
    v_nome := left(v_base, 6) || '_' || (100 + floor(random() * 900)::int)::text;
    if exists (
      select 1 from public.contas
      where lower(regexp_replace(trim(nome), '\s+', ' ', 'g')) = lower(v_nome)
    ) then
      if v_tent < 25 then
        v_nome := null;
      else
        v_nome := 'G_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      end if;
    end if;
  end loop;

  insert into public.contas (nome, senha_hash, convidado)
  values (
    v_nome,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 8)),
    true
  )
  returning * into v_c;

  return jsonb_build_object(
    'conta_id', v_c.id,
    'token', v_c.token,
    'nome', v_c.nome,
    'avatar_url', v_c.avatar_url,
    'avatar_versao', v_c.avatar_versao,
    'convidado', v_c.convidado
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.criar_conta_convidado(text) TO anon, authenticated;
