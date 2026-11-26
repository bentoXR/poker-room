// Internacionalização completa (PT-BR, ES, EN) + detecção automática por dispositivo/região + termos de poker em inglês por padrão
const CHAVE_IDIOMA = 'poker-idioma';
const CHAVE_TERMOS_TRADUZIDOS = 'poker-termos-traduzidos';

const REGIOES_ES = new Set([
  'ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO',
  'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR', 'GQ'
]);

function mapearTagIdioma(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const norm = tag.trim().toLowerCase().replace('_', '-');
  if (!norm) return null;
  if (norm === 'pt' || norm.startsWith('pt-')) return 'pt';
  if (norm === 'es' || norm.startsWith('es-')) return 'es';
  if (norm === 'en' || norm.startsWith('en-')) return 'en';
  const partes = norm.split('-');
  const regiao = (partes.find((p) => p.length === 2 && /^[a-z]{2}$/.test(p) && p !== partes[0]) || '').toUpperCase();
  if (regiao === 'BR' || regiao === 'PT' || regiao === 'AO' || regiao === 'MZ') return 'pt';
  if (REGIOES_ES.has(regiao)) return 'es';
  return null;
}

export function detectarIdiomaDispositivo() {
  try {
    const lista = [];
    if (typeof navigator !== 'undefined') {
      if (Array.isArray(navigator.languages)) lista.push(...navigator.languages);
      if (navigator.language) lista.push(navigator.language);
    }
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const loc = Intl.DateTimeFormat().resolvedOptions().locale;
      if (loc) lista.push(loc);
    }
    for (const tag of lista) {
      const m = mapearTagIdioma(tag);
      if (m) return m;
    }
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
      if (tz.includes('sao_paulo') || tz.includes('fortaleza') || tz.includes('recife') || tz.includes('bahia') || tz.includes('manaus') || tz.includes('belem')) {
        return 'pt';
      }
      if (tz.includes('madrid') || tz.includes('mexico') || tz.includes('buenos_aires') || tz.includes('bogota') || tz.includes('santiago') || tz.includes('lima')) {
        return 'es';
      }
    }
  } catch (e) {}
  return 'en'; // Padrão internacional (EUA / demais regiões)
}

function lerIdiomaSalvo() {
  try {
    const v = localStorage.getItem(CHAVE_IDIOMA);
    if (v === 'pt' || v === 'es' || v === 'en') return v;
  } catch (e) {}
  return detectarIdiomaDispositivo();
}

function lerTermosTraduzidosSalvo() {
  try {
    return localStorage.getItem(CHAVE_TERMOS_TRADUZIDOS) === '1';
  } catch (e) {}
  return false; // Padrão: termos de poker em inglês
}

let idiomaAtual = lerIdiomaSalvo();
let termosTraduzidos = lerTermosTraduzidosSalvo();
let hookAoMudar = null;

export function registrarHookIdioma(fn) {
  hookAoMudar = fn;
}

export function obterIdioma() {
  return idiomaAtual;
}

export function termosTraduzidosAtivo() {
  return idiomaAtual !== 'en' && termosTraduzidos;
}

export function fecharMenuIdiomaPerfil() {
  if (typeof document === 'undefined') return;
  const menu = document.getElementById('menu-idioma-perfil');
  const dropdown = document.getElementById('idioma-dropdown-perfil');
  const btn = document.getElementById('btn-idioma-perfil');
  if (menu) menu.hidden = true;
  if (dropdown) dropdown.classList.remove('aberto');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

export function alternarMenuIdiomaPerfil(forcarFechar) {
  if (typeof document === 'undefined') return;
  const menu = document.getElementById('menu-idioma-perfil');
  const dropdown = document.getElementById('idioma-dropdown-perfil');
  const btn = document.getElementById('btn-idioma-perfil');
  if (!menu) return;
  const abrir = forcarFechar === true ? false : menu.hidden;
  if (abrir) {
    const menuTema = document.getElementById('menu-tema-perfil');
    const dropdownTema = document.getElementById('tema-dropdown-perfil');
    const btnTema = document.getElementById('btn-tema-perfil');
    if (menuTema) menuTema.hidden = true;
    if (dropdownTema) dropdownTema.classList.remove('aberto');
    if (btnTema) btnTema.setAttribute('aria-expanded', 'false');
  }
  menu.hidden = !abrir;
  if (dropdown) dropdown.classList.toggle('aberto', abrir);
  if (btn) btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
}

export function escolherIdioma(lang) {
  if (lang !== 'pt' && lang !== 'es' && lang !== 'en') return;
  idiomaAtual = lang;
  try { localStorage.setItem(CHAVE_IDIOMA, lang); } catch (e) {}
  aplicarIdiomaDOM();
  fecharMenuIdiomaPerfil();
  if (hookAoMudar) hookAoMudar();
}

export function alternarTermosTraduzidos() {
  if (idiomaAtual === 'en') return;
  termosTraduzidos = !termosTraduzidos;
  try { localStorage.setItem(CHAVE_TERMOS_TRADUZIDOS, termosTraduzidos ? '1' : '0'); } catch (e) {}
  aplicarIdiomaDOM();
  if (hookAoMudar) hookAoMudar();
}

// Termos técnicos de poker: padrão em inglês mesmo em PT/ES, com opção de traduzir
const TERMOS = {
  raise:      { en: 'Raise',       pt: 'Aumentar',      es: 'Subir' },
  bet:        { en: 'Bet',         pt: 'Apostar',       es: 'Apostar' },
  call:       { en: 'Call',        pt: 'Pagar',         es: 'Igualar' },
  check:      { en: 'Check',       pt: 'Mesa',          es: 'Pasar' },
  fold:       { en: 'Fold',        pt: 'Desistir',      es: 'Retirarse' },
  allin:      { en: 'All-in',      pt: 'Tudo',          es: 'Todo' },
  pot:        { en: 'Pot',         pt: 'Pote',          es: 'Bote' },
  blinds:     { en: 'Blinds',      pt: 'Cegos',         es: 'Ciegas' },
  stack:      { en: 'Stack',       pt: 'Fichas',        es: 'Fichas' },
  preflop:    { en: 'Pre-flop',    pt: 'Pré-flop',      es: 'Pre-flop' },
  flop:       { en: 'Flop',        pt: 'Flop',          es: 'Flop' },
  turn:       { en: 'Turn',        pt: 'Turn',          es: 'Turn' },
  river:      { en: 'River',       pt: 'River',         es: 'River' },
  showdown:   { en: 'Showdown',    pt: 'Revelação',     es: 'Showdown' },
  dealer:     { en: 'Dealer',      pt: 'Distribuidor',  es: 'Repartidor' },
  smallblind: { en: 'Small Blind', pt: 'Cego Pequeno',  es: 'Ciega Pequeña' },
  bigblind:   { en: 'Big Blind',   pt: 'Cego Grande',   es: 'Ciega Grande' },
  splitpot:   { en: 'Split',       pt: 'Dividir',       es: 'Dividir' }
};

export function termo(chave) {
  const item = TERMOS[chave];
  if (!item) return chave;
  if (idiomaAtual === 'en' || !termosTraduzidos) return item.en;
  return item[idiomaAtual] || item.en;
}

const DICIONARIO = {
  pt: {
    'app.entrar': 'Entrar',
    'app.criar_conta': 'Criar conta',
    'app.sair': 'Sair',
    'app.voltar': 'Voltar',
    'app.fechar': 'Fechar',
    'app.enviar': 'Enviar',
    'app.salvar': 'Salvar',
    'app.remover': 'Remover',
    'app.confirmar': 'Confirmar',
    'app.mostrar': 'Mostrar',
    'app.ocultar': 'Ocultar',
    'login.slogan': 'Jogue com amigos <strong>online</strong> ou controle <strong>fichas e blinds</strong> na mesa presencial.',
    'login.seu_nome': 'Seu nome',
    'login.escolha_nome': 'Escolha um nome único (até 10 caracteres)',
    'login.ph_nome_entrar': 'Ex.: Pedro',
    'login.ph_nome_criar': 'Ex.: Pedro (máx. 10)',
    'login.sua_senha': 'Sua senha',
    'login.ph_senha_entrar': 'Digite sua senha',
    'login.ph_senha_criar': 'Mínimo 6 caracteres',
    'login.conf_senha': 'Confirmar senha',
    'login.ph_conf_senha': 'Repita a senha',
    'login.btn_entrar': 'Entrar',
    'login.btn_criar': 'Criar minha conta',
    'login.btn_convidado': '👤 Jogar como convidado (Guest)',
    'login.dica_entrar': 'Use o mesmo <strong>nome</strong> e <strong>senha</strong> sempre que voltar. No modo <strong>Convidado</strong>, se limpar o cache/cookies você perde o acesso às fichas salvas.',
    'login.dica_criar': 'Seu <strong>nome é único</strong> e sua senha fica criptografada. Você poderá adicionar <strong>foto de perfil</strong> logo em seguida.',
    'login.entrando': 'Entrando...',
    'login.criando': 'Criando conta...',
    'login.entrando_convidado': 'Entrando como convidado...',
    'perfil.dica_convidado': 'Conta Convidado (salva apenas no cache/cookies deste navegador). Defina uma senha abaixo se quiser torná-la permanente.',
    'salas.ola': 'Olá, ',
    'salas.perfil_sub': 'Meu perfil · idioma, tema e senha',
    'salas.titulo': 'Salas abertas',
    'salas.sub': 'Entre em uma mesa ou <strong>crie a sua</strong> em segundos.',
    'salas.criar': '+ Criar sala',
    'salas.dev': 'Sala DEV',
    'salas.buscando': 'Buscando salas abertas…',
    'salas.vazio_titulo': 'Nenhuma sala aberta agora',
    'salas.vazio_txt': 'Toque em <b>+ Criar sala</b> para chamar seus amigos para a mesa.',
    'salas.vazio_dev': 'Toque em <b>+ Criar sala</b> para chamar seus amigos ou teste sozinho na <b>Sala DEV</b>.',
    'salas.aguardando': 'Aguardando',
    'salas.jogador': 'jogador',
    'salas.jogadores': 'jogadores',
    'salas.sem_limite': 'Sem limite',
    'salas.turno': 'Turno <b>{s}s</b>',
    'salas.continuar': 'Continuar',
    'salas.modo_online': '🃏 Online',
    'salas.modo_presencial': '🪙 Presencial',
    'salas.modo_blackjack': '🂡 Blackjack',
    'criar.titulo': 'Nova sala',
    'criar.nome_sala': 'Nome da sala',
    'criar.ph_nome_sala': 'Ex.: Poker de Sexta',
    'criar.modo': 'Escolha o modo de jogo',
    'criar.presencial_nome': 'Presencial',
    'criar.presencial_desc': '<strong>Baralho físico</strong> · só fichas e pote',
    'criar.online_nome': 'Online',
    'criar.online_desc': '<strong>Baralho virtual</strong> · tudo automático',
    'criar.bj_nome': 'Blackjack',
    'criar.bj_desc': '<strong>Banca automática</strong> · 21',
    'criar.tempo': 'Tempo por jogada',
    'criar.sem_limite': 'Sem limite',
    'criar.subir_blinds': 'Subir blinds automaticamente',
    'criar.fixos': 'Fixos',
    'criar.aposta_min': 'Aposta mínima (Blackjack)',
    'criar.fichas': 'Fichas iniciais',
    'criar.ref_reais': 'Referência em R$',
    'criar.opcional': 'opcional',
    'criar.valor_jogador': 'Valor por jogador (R$)',
    'criar.ritmo': 'Ritmo da mesa',
    'criar.ritmo_rapido': 'Jogo rápido',
    'criar.ritmo_equilibrado': 'Equilibrado (padrão)',
    'criar.ritmo_longo': 'Jogo longo',
    'criar.bj_rotulo': 'Banca · Blackjack',
    'criar.bj_det': '<b>{s}</b> fichas · Aposta mínima <b>{m}</b>',
    'criar.bj_invalido': 'Informe fichas e aposta mínima válidos',
    'criar.poker_det': '<b>{s}</b> fichas · {blinds} <b>{sb}/{bb}</b>',
    'criar.poker_invalido': 'Informe fichas e blinds válidos',
    'criar.botao': 'Criar sala e abrir mesa',
    'criar.criando': 'Criando...',
    'criar.padrao_nome': 'Sala do {nome}',
    'dev.titulo': 'Sala DEV',
    'dev.aviso': 'Sala de teste <strong>só neste aparelho</strong>, com jogadores fictícios controlados automaticamente.',
    'dev.qtd': 'Quantidade de jogadores',
    'dev.criar': 'Criar sala DEV',
    'perfil.titulo': 'Meu perfil',
    'perfil.aba_conta': 'Perfil',
    'perfil.aba_prefs': 'Preferências',
    'perfil.foto_titulo': 'Foto de perfil',
    'perfil.foto_desc': 'Aparece no seu assento durante as partidas',
    'perfil.escolher_foto': 'Escolher foto',
    'perfil.nome_unico': 'Nome único da conta (até 10 caracteres)',
    'perfil.ph_nome': 'Seu nome (máx. 10)',
    'perfil.prefs': 'Preferências da mesa',
    'perfil.idioma': 'Idioma',
    'perfil.termos_titulo': 'Traduzir termos do poker',
    'perfil.termos_desc': 'Por padrão, termos como Raise, Call, Check, Fold, Stack e Pot ficam em inglês.',
    'perfil.tema': 'Tema visual',
    'perfil.tema_preto': 'Preto',
    'perfil.tema_classico': 'Sinuca',
    'perfil.tema_cassino': 'Cassino',
    'perfil.tema_liberdade': 'USA',
    'perfil.tema_tropical': 'Tropical',
    'perfil.tema_claro': 'Claro',
    'perfil.espiar_titulo': 'Segurar para espiar cartas',
    'perfil.espiar_desc': 'Quando ativo, suas cartas só aparecem enquanto você segura o dedo (ou Espaço no PC)',
    'perfil.seguranca': 'Segurança da conta',
    'perfil.senha_atual': 'Senha atual',
    'perfil.ph_senha_atual': 'Digite sua senha atual',
    'perfil.nova_senha': 'Nova senha',
    'perfil.ph_nova_senha': 'Mínimo 6 caracteres',
    'perfil.conf_nova_senha': 'Confirmar nova senha',
    'perfil.ph_conf_nova_senha': 'Repita a nova senha',
    'perfil.alterar_senha': 'Alterar senha',
    'perfil.senha_desc': 'Atualize sua senha de acesso',
    'perfil.sair_outros': 'Sair de outros aparelhos',
    'estado.ativado': 'Ativado',
    'estado.desativado': 'Desativado',
    'menu.titulo': 'Menu da sala',
    'menu.perfil': '👤 Perfil e tema',
    'menu.som_on': '🔊 Som: Ligado',
    'menu.som_off': '🔇 Som: Mudo',
    'menu.convidar': '🔗 Convidar',
    'menu.ausente': '⏸ Ficar ausente',
    'menu.voltar_jogo': '▶ Voltar ao jogo',
    'menu.guia': '♠ Guia de mãos',
    'menu.reais': '🏆 Placar (R$)',
    'menu.dev': '🛠 Painel DEV',
    'menu.sair': 'Sair da mesa',
    'menu.salas': '← Salas',
    'hist.titulo': 'Histórico',
    'chat.titulo': 'Chat da mesa',
    'chat.aba_chat': '💬 Chat',
    'chat.aba_votacao': '🗳 Votação',
    'chat.aba_log': '📜 Log',
    'chat.ph': 'Digite uma mensagem...',
    'guia.titulo': 'Guia de mãos',
    'guia.dica': 'Da mais forte para a mais fraca. Cartas apagadas não fazem parte da combinação: só servem para desempatar.',
    'criador.titulo': 'Opções do criador',
    'criador.iniciar': 'Iniciar partida',
    'criador.distribuir': 'Distribuir pote',
    'criador.encerrar': 'Encerrar sala',
    'reais.titulo': 'Placar e Acerto',
    'reais.quem_paga': 'Quem paga quem',
    'reais.copiar': 'Copiar resumo para WhatsApp',
    'carregando.voltando': 'Voltando para a mesa...',
    'carregando.tentar': 'Tentar de novo',
    'carregando.salas': 'Ir para as salas',
    'mesa.aguardando': 'Aguardando jogadores…',
    'mesa.aguardando_online': 'Aguardando jogadores confirmarem entrada',
    'mesa.aguardando_criador': 'Aguardando o criador iniciar a partida',
    'mesa.pausada': '⏸ Mesa pausada por votação',
    'mesa.sua_vez': 'Sua vez de jogar!',
    'mesa.vez_de': 'Vez de {nome}',
    'mesa.pre_acao_dica': 'Ação automática na sua vez',
    'mesa.rodada': 'Rodada {n}',
    'mesa.mao': 'Mão {n}',
    'mesa.nivel': 'Nível {n}',
    'mesa.min': 'Mín. {v}',
    'mesa.aposta_min': 'Aposta mín. {v}',
    'mesa.maior_aposta': 'Maior aposta {v}',
    'mesa.voce_jogador': 'Você é o Jogador {n}',
    'mesa.assistindo': 'Você está só assistindo',
    'mesa.voce': 'você',
    'mesa.pagar_blind': 'PAGAR BLIND',
    'mesa.sua_vez_label': 'Sua vez',
    'mesa.falta_pagar': 'Falta {v} para pagar',
    'mesa.aumentar_para': 'Aumentar para {v}',
    'mesa.apostar_v': 'Apostar {v}',
    'mesa.pagar_v': 'Pagar {v}',
    'mesa.call_v': '{call} {v}',
    'mesa.relogio_mesa': 'Mesa {t}',
    'online.sua_vez': 'SUA VEZ',
    'online.pronto': '✓ Pronto!',
    'online.confirmar': 'Participar da próxima mão',
    'online.revanche': 'Jogar revanche',
    'online.voltar_salas': 'Voltar às salas',
    'online.campeao': '🏆 Campeão: {nome}!',
    'online.esperando_2': 'Aguardando pelo menos <strong>2 jogadores</strong> entrarem na sala…',
    'online.esperando_ativos': 'Jogadores ausentes · aguardando <strong>2 ativos</strong> para iniciar',
    'online.pausada_prontos': '⏸ <strong>Mesa pausada</strong> · {c} de {e} prontos',
    'online.prontos_em': '<strong>{c} de {e} prontos</strong> · inicia em <strong data-contagem-online>{s}s</strong>',
    'online.prontos_precisa': '<strong>{c} de {e} prontos</strong> · precisa de <strong>2 jogadores</strong> para começar',
    'online.aguardando_el': 'aguardando…',
    'online.aguardando_vaga_bot': 'Um bot sairá da partida ao final da mão para sua entrada.',
    'online.entrar_proxima': 'Entrar na próxima mão',
    'online.estou_pronto': 'Estou pronto',
    'online.todos_prontos': 'Todos prontos',
    'online.auto_pronto': 'Auto-pronto',
    'online.ausente': 'Ausente',
    'online.sem_fichas_esp': 'Você ficou <strong>sem fichas</strong> · assistindo a mesa como espectador',
    'online.rabbit': '🐰 Ver cartas',
    'online.mostrando_cartas': 'Mostrando as cartas…',
    'online.auto': 'Auto',
    'bj.banca_titulo': 'BANCA · DEALER',
    'bj.faca_aposta': 'Faça sua aposta para iniciar a rodada',
    'bj.regra_dica': 'Banca para no 17 · Blackjack paga 3:2',
    'bj.status_encerrada': 'Fim de jogo — todos ficaram sem fichas.',
    'bj.status_resultado': 'Rodada encerrada · Faça sua próxima aposta',
    'bj.status_apostas': 'Faça sua aposta para receber as cartas',
    'bj.pedir': 'Pedir',
    'bj.pedir_sub': '+1 carta',
    'bj.parar': 'Parar',
    'bj.parar_sub': 'Manter',
    'bj.dobrar': 'Dobrar',
    'bj.dobrar_sub': '2x + 1',
    'bj.dividir': 'Dividir',
    'bj.dividir_sub': '2 mãos',
    'bj.apostar': 'Apostar {v}',
    'bj.enviando': 'Enviando…',
    'bj.repetir': 'Repetir',
    'bj.min_btn': 'Mín.',
    'bj.aposta_tag': 'Aposta {v}',
    'bj.aposta_conf': 'Aposta confirmada: <b>{v}</b> · Aguardando outros jogadores…',
    'bj.banca_jogando': 'Banca jogando…',
    'bj.sem_fichas_fora': 'Você ficou sem fichas suficientes (mín. {min}) e está fora desta partida.',
    'bj.todos_sem_fichas': 'Todos os jogadores ficaram sem fichas nesta mesa.',
    'bj.revanche': 'Revanche (reiniciar fichas)',
    'bj.aguardando': 'Aguardando',
    'bj.sem_fichas': 'Sem fichas',
    'bj.apostou': 'Apostou {v}',
    'bj.apostando': 'Apostando…',
    'bj.fora_rodada': 'Fora da rodada',
    'bj.estourou': 'Estourou ({p})',
    'bj.ganhou': 'Ganhou +{v}',
    'bj.empate': 'Empate (devolveu)',
    'bj.banca_venceu': 'Banca venceu',
    'bj.anuncio_vez': 'SUA VEZ',
    'bj.anuncio_vez_sub': 'Pedir, Parar, Dobrar ou Dividir',
    'bj.anuncio_bj_sub': 'Paga 3:2 · +{v} fichas',
    'bj.anuncio_ganhou': 'VOCÊ GANHOU!',
    'bj.anuncio_ganhou_sub': '+{v} fichas',
    'bj.anuncio_empate': 'EMPATE',
    'bj.anuncio_empate_sub': 'Aposta devolvida',
    'bj.anuncio_estourou': 'ESTOUROU!',
    'bj.anuncio_banca_venceu': 'BANCA VENCEU',
    'bj.anuncio_banca_bj': 'Banca fez Blackjack',
    'bj.anuncio_banca_pts': 'Banca: {p}',
    'bj.conf_todos_dev': 'Confirmar todos (DEV)',
    'salas.jogar_agora': 'JOGAR AGORA',
    'salas.jogar_agora_sub': 'Entre em uma mesa online ou jogue contra bots',
    'salas.bots_ativados': 'Bots ativados',
    'salas.ja_titulo': 'Jogar Agora',
    'salas.ja_desc': 'Escolha como deseja começar sua partida de Poker Online:',
    'salas.ja_online': 'Entrar em partida',
    'salas.ja_online_desc': 'Vai para uma mesa online com jogadores reais',
    'salas.ja_solo': 'Jogar solo com bots',
    'salas.ja_solo_desc': 'Partida privada rápida contra bots híbridos',
    'criar.bots': 'Preencher com Bots',
    'criar.bots_off': 'Desligado',
    'criar.bots_on': 'Ligado',
    'criar.bots_dica': 'Bots híbridos entram e saem naturalmente e sempre cedem lugar para jogadores reais.',
    'mesa.rebuy_1': '1 stack',
    'mesa.rebuy_meio': '½ stack',
    'mesa.rebuy_quarto': '¼ stack',
    'mesa.espectar': 'Espectar',
    'mesa.espectando_rebuy': 'Você está espectando. Compre fichas para voltar à mesa.',
    'mesa.espectando': 'Você está espectando a mesa.',
    'mesa.sem_fichas_rebuy': 'Você ficou sem fichas. Compre mais ou especte a mesa.',
    'criar.privada': 'Privacidade da sala',
    'criar.privada_off': 'Pública',
    'criar.privada_on': 'Privada (com senha)',
    'criar.tempo_curto': 'Tempo',
    'criar.blinds_curto': 'Subir blinds',
    'criar.bots_curto': 'Bots',
    'criar.privada_curto': 'Privacidade',
    'criar.privada_on_curto': '🔒 Privada',
    'criar.ph_senha': 'Digite a senha da sala',
    'criar.erro_senha': 'Digite uma senha para a sala privada.',
    'salas.privada': '🔒 Privada',
    'salas.senha_titulo': 'Sala privada',
    'salas.senha_desc': 'Digite a senha para entrar na mesa:',
    'salas.senha_ph': 'Senha da sala',
    'salas.senha_entrar': 'Entrar na mesa'
  },
  es: {
    'app.entrar': 'Entrar',
    'app.criar_conta': 'Crear cuenta',
    'app.sair': 'Salir',
    'app.voltar': 'Volver',
    'app.fechar': 'Cerrar',
    'app.enviar': 'Enviar',
    'app.salvar': 'Guardar',
    'app.remover': 'Quitar',
    'app.confirmar': 'Confirmar',
    'app.mostrar': 'Mostrar',
    'app.ocultar': 'Ocultar',
    'login.slogan': 'Juega con amigos <strong>online</strong> o lleva el control de <strong>fichas y ciegas</strong> en la mesa presencial.',
    'login.seu_nome': 'Tu nombre',
    'login.escolha_nome': 'Elige un nombre único (hasta 10 caracteres)',
    'login.ph_nome_entrar': 'Ej.: Carlos',
    'login.ph_nome_criar': 'Ej.: Carlos (máx. 10)',
    'login.sua_senha': 'Tu contraseña',
    'login.ph_senha_entrar': 'Escribe tu contraseña',
    'login.ph_senha_criar': 'Mínimo 6 caracteres',
    'login.conf_senha': 'Confirmar contraseña',
    'login.ph_conf_senha': 'Repite la contraseña',
    'login.btn_entrar': 'Entrar',
    'login.btn_criar': 'Crear mi cuenta',
    'login.btn_convidado': '👤 Jugar como invitado (Guest)',
    'login.dica_entrar': 'Usa el mismo <strong>nombre</strong> y <strong>contraseña</strong> al volver. En modo <strong>Invitado</strong>, si borras caché/cookies perderás las fichas guardadas.',
    'login.dica_criar': 'Tu <strong>nombre es único</strong> y tu contraseña se cifra. Luego podrás añadir una <strong>foto de perfil</strong>.',
    'login.entrando': 'Entrando...',
    'login.criando': 'Creando cuenta...',
    'login.entrando_convidado': 'Entrando como invitado...',
    'perfil.dica_convidado': 'Cuenta de Invitado (guardada solo en este navegador). Define una contraseña abajo para hacerla permanente.',
    'salas.ola': 'Hola, ',
    'salas.perfil_sub': 'Mi perfil · idioma, tema y contraseña',
    'salas.titulo': 'Salas abiertas',
    'salas.sub': 'Únete a una mesa o <strong>crea la tuya</strong> en segundos.',
    'salas.criar': '+ Crear sala',
    'salas.dev': 'Sala DEV',
    'salas.buscando': 'Buscando salas abiertas…',
    'salas.vazio_titulo': 'No hay salas abiertas ahora',
    'salas.vazio_txt': 'Pulsa <b>+ Crear sala</b> para invitar a tus amigos a la mesa.',
    'salas.vazio_dev': 'Pulsa <b>+ Crear sala</b> para invitar amigos o prueba solo en <b>Sala DEV</b>.',
    'salas.aguardando': 'Esperando',
    'salas.jogador': 'jugador',
    'salas.jogadores': 'jugadores',
    'salas.sem_limite': 'Sin límite',
    'salas.turno': 'Turno <b>{s}s</b>',
    'salas.continuar': 'Continuar',
    'salas.modo_online': '🃏 Online',
    'salas.modo_presencial': '🪙 Presencial',
    'salas.modo_blackjack': '🂡 Blackjack',
    'criar.titulo': 'Nueva sala',
    'criar.nome_sala': 'Nombre de la sala',
    'criar.ph_nome_sala': 'Ej.: Póker del Viernes',
    'criar.modo': 'Elige el modo de juego',
    'criar.presencial_nome': 'Presencial',
    'criar.presencial_desc': '<strong>Baraja física</strong> · solo fichas y bote',
    'criar.online_nome': 'Online',
    'criar.online_desc': '<strong>Baraja virtual</strong> · todo automático',
    'criar.bj_nome': 'Blackjack',
    'criar.bj_desc': '<strong>Banca automática</strong> · 21',
    'criar.tempo': 'Tiempo por turno',
    'criar.sem_limite': 'Sin límite',
    'criar.subir_blinds': 'Subir ciegas automáticamente',
    'criar.fixos': 'Fijas',
    'criar.aposta_min': 'Apuesta mínima (Blackjack)',
    'criar.fichas': 'Fichas iniciales',
    'criar.ref_reais': 'Referencia en R$',
    'criar.opcional': 'opcional',
    'criar.valor_jogador': 'Valor por jugador (R$)',
    'criar.ritmo': 'Ritmo de la mesa',
    'criar.ritmo_rapido': 'Juego rápido',
    'criar.ritmo_equilibrado': 'Equilibrado (estándar)',
    'criar.ritmo_longo': 'Juego largo',
    'criar.bj_rotulo': 'Banca · Blackjack',
    'criar.bj_det': '<b>{s}</b> fichas · Apuesta mínima <b>{m}</b>',
    'criar.bj_invalido': 'Ingresa fichas y apuesta mínima válidas',
    'criar.poker_det': '<b>{s}</b> fichas · {blinds} <b>{sb}/{bb}</b>',
    'criar.poker_invalido': 'Ingresa fichas y ciegas válidas',
    'criar.botao': 'Crear sala y abrir mesa',
    'criar.criando': 'Creando...',
    'criar.padrao_nome': 'Sala de {nome}',
    'dev.titulo': 'Sala DEV',
    'dev.aviso': 'Sala de prueba <strong>solo en este dispositivo</strong>, con jugadores ficticios.',
    'dev.qtd': 'Cantidad de jugadores',
    'dev.criar': 'Crear sala DEV',
    'perfil.titulo': 'Mi perfil',
    'perfil.aba_conta': 'Perfil',
    'perfil.aba_prefs': 'Preferencias',
    'perfil.foto_titulo': 'Foto de perfil',
    'perfil.foto_desc': 'Aparece en tu asiento durante las partidas',
    'perfil.escolher_foto': 'Elegir foto',
    'perfil.nome_unico': 'Nombre único de la cuenta (hasta 10 caracteres)',
    'perfil.ph_nome': 'Tu nombre (máx. 10)',
    'perfil.prefs': 'Preferencias de la mesa',
    'perfil.idioma': 'Idioma',
    'perfil.termos_titulo': 'Traducir términos del póker',
    'perfil.termos_desc': 'Por defecto, términos como Raise, Call, Check, Fold, Stack y Pot se mantienen en inglés.',
    'perfil.tema': 'Tema visual',
    'perfil.tema_preto': 'Negro',
    'perfil.tema_classico': 'Billar',
    'perfil.tema_cassino': 'Casino',
    'perfil.tema_liberdade': 'USA',
    'perfil.tema_tropical': 'Tropical',
    'perfil.tema_claro': 'Claro',
    'perfil.espiar_titulo': 'Mantener para ver cartas',
    'perfil.espiar_desc': 'Cuando está activo, tus cartas solo se ven mientras mantienes pulsado (o Espacio en PC)',
    'perfil.seguranca': 'Seguridad de la cuenta',
    'perfil.senha_atual': 'Contraseña actual',
    'perfil.ph_senha_atual': 'Escribe tu contraseña actual',
    'perfil.nova_senha': 'Nueva contraseña',
    'perfil.ph_nova_senha': 'Mínimo 6 caracteres',
    'perfil.conf_nova_senha': 'Confirmar nueva contraseña',
    'perfil.ph_conf_nova_senha': 'Repite la nueva contraseña',
    'perfil.alterar_senha': 'Cambiar contraseña',
    'perfil.senha_desc': 'Actualiza tu contraseña de acceso',
    'perfil.sair_outros': 'Cerrar sesión en otros dispositivos',
    'estado.ativado': 'Activado',
    'estado.desativado': 'Desactivado',
    'menu.titulo': 'Menú de la sala',
    'menu.perfil': '👤 Perfil y tema',
    'menu.som_on': '🔊 Sonido: Activado',
    'menu.som_off': '🔇 Sonido: Silencio',
    'menu.convidar': '🔗 Invitar',
    'menu.ausente': '⏸ Ausentarse',
    'menu.voltar_jogo': '▶ Volver al juego',
    'menu.guia': '♠ Guía de manos',
    'menu.reais': '🏆 Marcador',
    'menu.dev': '🛠 Panel DEV',
    'menu.sair': 'Salir de la mesa',
    'menu.salas': '← Salas',
    'hist.titulo': 'Historial',
    'chat.titulo': 'Chat de la mesa',
    'chat.aba_chat': '💬 Chat',
    'chat.aba_votacao': '🗳 Votación',
    'chat.aba_log': '📜 Log',
    'chat.ph': 'Escribe un mensaje...',
    'guia.titulo': 'Guía de manos',
    'guia.dica': 'De la más fuerte a la más débil. Las cartas atenuadas solo sirven para desempatar.',
    'criador.titulo': 'Opciones del anfitrión',
    'criador.iniciar': 'Iniciar partida',
    'criador.distribuir': 'Repartir bote',
    'criador.encerrar': 'Cerrar sala',
    'reais.titulo': 'Marcador y Cuentas',
    'reais.quem_paga': 'Quién paga a quién',
    'reais.copiar': 'Copiar resumen para WhatsApp',
    'carregando.voltando': 'Volviendo a la mesa...',
    'carregando.tentar': 'Reintentar',
    'carregando.salas': 'Ir a las salas',
    'mesa.aguardando': 'Esperando jugadores…',
    'mesa.aguardando_online': 'Esperando confirmación de los jugadores',
    'mesa.aguardando_criador': 'Esperando que el anfitrión inicie',
    'mesa.pausada': '⏸ Mesa pausada por votación',
    'mesa.sua_vez': '¡Tu turno!',
    'mesa.vez_de': 'Turno de {nome}',
    'mesa.pre_acao_dica': 'Acción automática en tu turno',
    'mesa.rodada': 'Ronda {n}',
    'mesa.mao': 'Mano {n}',
    'mesa.nivel': 'Nivel {n}',
    'mesa.min': 'Mín. {v}',
    'mesa.aposta_min': 'Apuesta mín. {v}',
    'mesa.maior_aposta': 'Apuesta mayor {v}',
    'mesa.voce_jogador': 'Eres el Jugador {n}',
    'mesa.assistindo': 'Estás mirando la mesa',
    'mesa.voce': 'tú',
    'mesa.pagar_blind': 'PAGAR CIEGA',
    'mesa.sua_vez_label': 'Tu turno',
    'mesa.falta_pagar': 'Falta {v} para igualar',
    'mesa.aumentar_para': 'Subir a {v}',
    'mesa.apostar_v': 'Apostar {v}',
    'mesa.pagar_v': 'Igualar {v}',
    'mesa.call_v': '{call} {v}',
    'mesa.relogio_mesa': 'Mesa {t}',
    'online.sua_vez': 'TU TURNO',
    'online.pronto': '✓ ¡Listo!',
    'online.confirmar': 'Jugar la próxima mano',
    'online.revanche': 'Jugar revancha',
    'online.voltar_salas': 'Volver a las salas',
    'online.campeao': '🏆 Campeón: {nome}!',
    'online.esperando_2': 'Esperando al menos <strong>2 jugadores</strong> en la sala…',
    'online.esperando_ativos': 'Jugadores ausentes · esperando <strong>2 activos</strong> para iniciar',
    'online.pausada_prontos': '⏸ <strong>Mesa pausada</strong> · {c} de {e} listos',
    'online.prontos_em': '<strong>{c} de {e} listos</strong> · inicia en <strong data-contagem-online>{s}s</strong>',
    'online.prontos_precisa': '<strong>{c} de {e} listos</strong> · se necesitan <strong>2 jugadores</strong> para empezar',
    'online.aguardando_el': 'esperando…',
    'online.aguardando_vaga_bot': 'Un bot saldrá de la partida al final de la mano para tu entrada.',
    'online.entrar_proxima': 'Jugar próxima mano',
    'online.estou_pronto': 'Estoy listo',
    'online.todos_prontos': 'Todos listos',
    'online.auto_pronto': 'Auto-listo',
    'online.ausente': 'Ausente',
    'online.sem_fichas_esp': 'Te quedaste <strong>sin fichas</strong> · mirando como espectador',
    'online.rabbit': '🐰 Ver cartas',
    'online.mostrando_cartas': 'Mostrando cartas…',
    'online.auto': 'Auto',
    'bj.banca_titulo': 'BANCA · DEALER',
    'bj.faca_aposta': 'Haz tu apuesta para iniciar la ronda',
    'bj.regra_dica': 'Banca se planta en 17 · Blackjack paga 3:2',
    'bj.status_encerrada': 'Fin del juego — todos sin fichas.',
    'bj.status_resultado': 'Ronda terminada · Haz tu próxima apuesta',
    'bj.status_apostas': 'Haz tu apuesta para recibir cartas',
    'bj.pedir': 'Pedir',
    'bj.pedir_sub': '+1 carta',
    'bj.parar': 'Plantarse',
    'bj.parar_sub': 'Quedarse',
    'bj.dobrar': 'Doblar',
    'bj.dobrar_sub': '2x + 1',
    'bj.dividir': 'Dividir',
    'bj.dividir_sub': '2 manos',
    'bj.apostar': 'Apostar {v}',
    'bj.enviando': 'Enviando…',
    'bj.repetir': 'Repetir',
    'bj.min_btn': 'Mín.',
    'bj.aposta_tag': 'Apuesta {v}',
    'bj.aposta_conf': 'Apuesta confirmada: <b>{v}</b> · Esperando jugadores…',
    'bj.banca_jogando': 'La banca está jugando…',
    'bj.sem_fichas_fora': 'Te quedaste sin fichas suficientes (mín. {min}) y estás fuera.',
    'bj.todos_sem_fichas': 'Todos los jugadores se quedaron sin fichas.',
    'bj.revanche': 'Revancha (reiniciar fichas)',
    'bj.aguardando': 'Esperando',
    'bj.sem_fichas': 'Sin fichas',
    'bj.apostou': 'Apostó {v}',
    'bj.apostando': 'Apostando…',
    'bj.fora_rodada': 'Fuera de ronda',
    'bj.estourou': 'Se pasó ({p})',
    'bj.ganhou': 'Ganó +{v}',
    'bj.empate': 'Empate (devuelto)',
    'bj.banca_venceu': 'Ganó la banca',
    'bj.anuncio_vez': 'TU TURNO',
    'bj.anuncio_vez_sub': 'Pedir, Plantarse, Doblar o Dividir',
    'bj.anuncio_bj_sub': 'Paga 3:2 · +{v} fichas',
    'bj.anuncio_ganhou': '¡GANASTE!',
    'bj.anuncio_ganhou_sub': '+{v} fichas',
    'bj.anuncio_empate': 'EMPATE',
    'bj.anuncio_empate_sub': 'Apuesta devuelta',
    'bj.anuncio_estourou': '¡TE PASASTE!',
    'bj.anuncio_banca_venceu': 'GANÓ LA BANCA',
    'bj.anuncio_banca_bj': 'La banca hizo Blackjack',
    'bj.anuncio_banca_pts': 'Banca: {p}',
    'bj.conf_todos_dev': 'Confirmar todos (DEV)',
    'salas.jogar_agora': 'JUGAR AHORA',
    'salas.jogar_agora_sub': 'Entra a una mesa online o juega contra bots',
    'salas.bots_ativados': 'Bots activados',
    'salas.ja_titulo': 'Jugar Ahora',
    'salas.ja_desc': 'Elige cómo empezar tu partida de Poker Online:',
    'salas.ja_online': 'Entrar a una partida',
    'salas.ja_online_desc': 'Va a una mesa online con jugadores reales',
    'salas.ja_solo': 'Jugar solo con bots',
    'salas.ja_solo_desc': 'Partida privada rápida contra bots híbridos',
    'criar.bots': 'Rellenar con Bots',
    'criar.bots_off': 'Apagado',
    'criar.bots_on': 'Encendido',
    'criar.bots_dica': 'Los bots híbridos entran y salen de forma natural y siempre ceden lugar a jugadores reales.',
    'mesa.rebuy_1': '1 stack',
    'mesa.rebuy_meio': '½ stack',
    'mesa.rebuy_quarto': '¼ stack',
    'mesa.espectar': 'Observar',
    'mesa.espectando_rebuy': 'Estás observando. Compra fichas para volver a la mesa.',
    'mesa.espectando': 'Estás observando la mesa.',
    'mesa.sem_fichas_rebuy': 'Te quedaste sin fichas. Compra más u observa la mesa.',
    'criar.privada': 'Privacidad de la sala',
    'criar.privada_off': 'Pública',
    'criar.privada_on': 'Privada (con contraseña)',
    'criar.tempo_curto': 'Tiempo',
    'criar.blinds_curto': 'Subir blinds',
    'criar.bots_curto': 'Bots',
    'criar.privada_curto': 'Privacidad',
    'criar.privada_on_curto': '🔒 Privada',
    'criar.ph_senha': 'Ingresa la contraseña de la sala',
    'criar.erro_senha': 'Ingresa una contraseña para la sala privada.',
    'salas.privada': '🔒 Privada',
    'salas.senha_titulo': 'Sala privada',
    'salas.senha_desc': 'Ingresa la contraseña para entrar a la mesa:',
    'salas.senha_ph': 'Contraseña de la sala',
    'salas.senha_entrar': 'Entrar a la mesa'
  },
  en: {
    'app.entrar': 'Sign in',
    'app.criar_conta': 'Sign up',
    'app.sair': 'Sign out',
    'app.voltar': 'Back',
    'app.fechar': 'Close',
    'app.enviar': 'Send',
    'app.salvar': 'Save',
    'app.remover': 'Remove',
    'app.confirmar': 'Confirm',
    'app.mostrar': 'Show',
    'app.ocultar': 'Hide',
    'login.slogan': 'Play with friends <strong>online</strong> or track <strong>chips and blinds</strong> on a live table.',
    'login.seu_nome': 'Your name',
    'login.escolha_nome': 'Choose a unique name (up to 10 chars)',
    'login.ph_nome_entrar': 'E.g. Alex',
    'login.ph_nome_criar': 'E.g. Alex (max 10)',
    'login.sua_senha': 'Password',
    'login.ph_senha_entrar': 'Enter your password',
    'login.ph_senha_criar': 'At least 6 characters',
    'login.conf_senha': 'Confirm password',
    'login.ph_conf_senha': 'Repeat password',
    'login.btn_entrar': 'Sign in',
    'login.btn_criar': 'Create account',
    'login.btn_convidado': '👤 Play as Guest',
    'login.dica_entrar': 'Use the same <strong>name</strong> and <strong>password</strong> whenever you return. In <strong>Guest</strong> mode, clearing browser cache/cookies loses access to saved chips.',
    'login.dica_criar': 'Your <strong>name is unique</strong> and your password is encrypted. You can add a <strong>profile photo</strong> right after.',
    'login.entrando': 'Signing in...',
    'login.criando': 'Creating account...',
    'login.entrando_convidado': 'Joining as guest...',
    'perfil.dica_convidado': 'Guest Account (saved only in this browser). Set a password below if you want to make it permanent.',
    'salas.ola': 'Hi, ',
    'salas.perfil_sub': 'My profile · language, theme & password',
    'salas.titulo': 'Open rooms',
    'salas.sub': 'Join a table or <strong>create yours</strong> in seconds.',
    'salas.criar': '+ Create room',
    'salas.dev': 'DEV Room',
    'salas.buscando': 'Looking for open rooms…',
    'salas.vazio_titulo': 'No open rooms right now',
    'salas.vazio_txt': 'Tap <b>+ Create room</b> to invite your friends to the table.',
    'salas.vazio_dev': 'Tap <b>+ Create room</b> for friends or test solo in <b>DEV Room</b>.',
    'salas.aguardando': 'Waiting',
    'salas.jogador': 'player',
    'salas.jogadores': 'players',
    'salas.sem_limite': 'No limit',
    'salas.turno': 'Turn <b>{s}s</b>',
    'salas.continuar': 'Rejoin',
    'salas.modo_online': '🃏 Online',
    'salas.modo_presencial': '🪙 Live Table',
    'salas.modo_blackjack': '🂡 Blackjack',
    'criar.titulo': 'New room',
    'criar.nome_sala': 'Room name',
    'criar.ph_nome_sala': 'E.g. Friday Poker',
    'criar.modo': 'Choose game mode',
    'criar.presencial_nome': 'Live Table',
    'criar.presencial_desc': '<strong>Physical deck</strong> · chips & pot only',
    'criar.online_nome': 'Online',
    'criar.online_desc': '<strong>Virtual deck</strong> · automated',
    'criar.bj_nome': 'Blackjack',
    'criar.bj_desc': '<strong>Auto dealer</strong> · 21',
    'criar.tempo': 'Turn time limit',
    'criar.sem_limite': 'No limit',
    'criar.subir_blinds': 'Auto-raise blinds',
    'criar.fixos': 'Fixed',
    'criar.aposta_min': 'Minimum bet (Blackjack)',
    'criar.fichas': 'Starting stack',
    'criar.ref_reais': 'Cash reference',
    'criar.opcional': 'optional',
    'criar.valor_jogador': 'Buy-in per player',
    'criar.ritmo': 'Table pace',
    'criar.ritmo_rapido': 'Turbo pace',
    'criar.ritmo_equilibrado': 'Balanced (standard)',
    'criar.ritmo_longo': 'Deep stack',
    'criar.bj_rotulo': 'House · Blackjack',
    'criar.bj_det': '<b>{s}</b> chips · Min. bet <b>{m}</b>',
    'criar.bj_invalido': 'Enter valid stack and min. bet',
    'criar.poker_det': '<b>{s}</b> chips · {blinds} <b>{sb}/{bb}</b>',
    'criar.poker_invalido': 'Enter valid stack and blinds',
    'criar.botao': 'Create room & open table',
    'criar.criando': 'Creating...',
    'criar.padrao_nome': "{nome}'s Room",
    'dev.titulo': 'DEV Room',
    'dev.aviso': 'Test room <strong>on this device only</strong>, with simulated players.',
    'dev.qtd': 'Number of players',
    'dev.criar': 'Create DEV room',
    'perfil.titulo': 'My profile',
    'perfil.aba_conta': 'Profile',
    'perfil.aba_prefs': 'Preferences',
    'perfil.foto_titulo': 'Profile photo',
    'perfil.foto_desc': 'Shown on your seat at the table',
    'perfil.escolher_foto': 'Choose photo',
    'perfil.nome_unico': 'Unique account name (up to 10 chars)',
    'perfil.ph_nome': 'Your name (max 10)',
    'perfil.prefs': 'Table preferences',
    'perfil.idioma': 'Language',
    'perfil.termos_titulo': 'Translate poker terms',
    'perfil.termos_desc': 'In English, all poker terms are already shown in English.',
    'perfil.tema': 'Visual theme',
    'perfil.tema_preto': 'Black',
    'perfil.tema_classico': 'Pool Felt',
    'perfil.tema_cassino': 'Casino',
    'perfil.tema_liberdade': 'USA',
    'perfil.tema_tropical': 'Tropical',
    'perfil.tema_claro': 'Light',
    'perfil.espiar_titulo': 'Hold to peek cards',
    'perfil.espiar_desc': 'When enabled, your hole cards show only while holding (or Spacebar on PC)',
    'perfil.seguranca': 'Account security',
    'perfil.senha_atual': 'Current password',
    'perfil.ph_senha_atual': 'Enter current password',
    'perfil.nova_senha': 'New password',
    'perfil.ph_nova_senha': 'At least 6 characters',
    'perfil.conf_nova_senha': 'Confirm new password',
    'perfil.ph_conf_nova_senha': 'Repeat new password',
    'perfil.alterar_senha': 'Change password',
    'perfil.senha_desc': 'Update your account password',
    'perfil.sair_outros': 'Sign out other devices',
    'estado.ativado': 'Enabled',
    'estado.desativado': 'Disabled',
    'menu.titulo': 'Room menu',
    'menu.perfil': '👤 Profile & theme',
    'menu.som_on': '🔊 Sound: On',
    'menu.som_off': '🔇 Sound: Muted',
    'menu.convidar': '🔗 Invite',
    'menu.ausente': '⏸ Sit out',
    'menu.voltar_jogo': '▶ Back in game',
    'menu.guia': '♠ Hand rankings',
    'menu.reais': '🏆 Settlement',
    'menu.dev': '🛠 DEV Panel',
    'menu.sair': 'Leave table',
    'menu.salas': '← Lobby',
    'hist.titulo': 'History',
    'chat.titulo': 'Table chat',
    'chat.aba_chat': '💬 Chat',
    'chat.aba_votacao': '🗳 Vote',
    'chat.aba_log': '📜 Log',
    'chat.ph': 'Type a message...',
    'guia.titulo': 'Hand rankings',
    'guia.dica': 'From strongest to weakest. Dimmed cards are kickers only.',
    'criador.titulo': 'Host options',
    'criador.iniciar': 'Start game',
    'criador.distribuir': 'Award pot',
    'criador.encerrar': 'Close room',
    'reais.titulo': 'Standings & Settlement',
    'reais.quem_paga': 'Who owes whom',
    'reais.copiar': 'Copy summary for WhatsApp',
    'carregando.voltando': 'Returning to table...',
    'carregando.tentar': 'Try again',
    'carregando.salas': 'Go to lobby',
    'mesa.aguardando': 'Waiting for players…',
    'mesa.aguardando_online': 'Waiting for players to confirm',
    'mesa.aguardando_criador': 'Waiting for host to start',
    'mesa.pausada': '⏸ Table paused by vote',
    'mesa.sua_vez': 'Your turn!',
    'mesa.vez_de': "{nome}'s turn",
    'mesa.pre_acao_dica': 'Auto-action on your turn',
    'mesa.rodada': 'Round {n}',
    'mesa.mao': 'Hand {n}',
    'mesa.nivel': 'Level {n}',
    'mesa.min': 'Min. {v}',
    'mesa.aposta_min': 'Min. bet {v}',
    'mesa.maior_aposta': 'Top bet {v}',
    'mesa.voce_jogador': 'You are Player {n}',
    'mesa.assistindo': 'Spectating',
    'mesa.voce': 'you',
    'mesa.pagar_blind': 'PAY BLIND',
    'mesa.sua_vez_label': 'Your turn',
    'mesa.falta_pagar': '{v} to call',
    'mesa.aumentar_para': 'Raise to {v}',
    'mesa.apostar_v': 'Bet {v}',
    'mesa.pagar_v': 'Call {v}',
    'mesa.call_v': '{call} {v}',
    'mesa.relogio_mesa': 'Table {t}',
    'online.sua_vez': 'YOUR TURN',
    'online.pronto': '✓ Ready!',
    'online.confirmar': 'Join next hand',
    'online.revanche': 'Play rematch',
    'online.voltar_salas': 'Back to lobby',
    'online.campeao': '🏆 Champion: {nome}!',
    'online.esperando_2': 'Waiting for at least <strong>2 players</strong> to join…',
    'online.esperando_ativos': 'Players sitting out · waiting for <strong>2 active</strong> players',
    'online.pausada_prontos': '⏸ <strong>Table paused</strong> · {c} of {e} ready',
    'online.prontos_em': '<strong>{c} of {e} ready</strong> · starts in <strong data-contagem-online>{s}s</strong>',
    'online.prontos_precisa': '<strong>{c} of {e} ready</strong> · needs <strong>2 players</strong> to start',
    'online.aguardando_el': 'waiting…',
    'online.aguardando_vaga_bot': 'A bot will leave the table at the end of this hand so you can join.',
    'online.entrar_proxima': 'Join next hand',
    'online.estou_pronto': "I'm ready",
    'online.todos_prontos': 'All ready',
    'online.auto_pronto': 'Auto-ready',
    'online.ausente': 'Sit out',
    'online.sem_fichas_esp': 'You ran <strong>out of chips</strong> · watching as spectator',
    'online.rabbit': '🐰 Rabbit hunt',
    'online.mostrando_cartas': 'Revealing cards…',
    'online.auto': 'Auto',
    'bj.banca_titulo': 'HOUSE · DEALER',
    'bj.faca_aposta': 'Place your bet to start the round',
    'bj.regra_dica': 'Dealer stands on all 17 · Blackjack pays 3:2',
    'bj.status_encerrada': 'Game over — all players busted.',
    'bj.status_resultado': 'Round over · Place your next bet',
    'bj.status_apostas': 'Place your bet to receive cards',
    'bj.pedir': 'Hit',
    'bj.pedir_sub': '+1 card',
    'bj.parar': 'Stand',
    'bj.parar_sub': 'Hold',
    'bj.dobrar': 'Double',
    'bj.dobrar_sub': '2x + 1',
    'bj.dividir': 'Split',
    'bj.dividir_sub': '2 hands',
    'bj.apostar': 'Bet {v}',
    'bj.enviando': 'Sending…',
    'bj.repetir': 'Repeat',
    'bj.min_btn': 'Min',
    'bj.aposta_tag': 'Bet {v}',
    'bj.aposta_conf': 'Bet confirmed: <b>{v}</b> · Waiting for players…',
    'bj.banca_jogando': 'Dealer playing…',
    'bj.sem_fichas_fora': 'Not enough chips (min. {min}). You are out of this match.',
    'bj.todos_sem_fichas': 'All players ran out of chips at this table.',
    'bj.revanche': 'Rematch (reset stacks)',
    'bj.aguardando': 'Waiting',
    'bj.sem_fichas': 'No chips',
    'bj.apostou': 'Bet {v}',
    'bj.apostando': 'Betting…',
    'bj.fora_rodada': 'Sitting out',
    'bj.estourou': 'Bust ({p})',
    'bj.ganhou': 'Won +{v}',
    'bj.empate': 'Push (returned)',
    'bj.banca_venceu': 'Dealer won',
    'bj.anuncio_vez': 'YOUR TURN',
    'bj.anuncio_vez_sub': 'Hit, Stand, Double or Split',
    'bj.anuncio_bj_sub': 'Pays 3:2 · +{v} chips',
    'bj.anuncio_ganhou': 'YOU WON!',
    'bj.anuncio_ganhou_sub': '+{v} chips',
    'bj.anuncio_empate': 'PUSH',
    'bj.anuncio_empate_sub': 'Bet returned',
    'bj.anuncio_estourou': 'BUST!',
    'bj.anuncio_banca_venceu': 'DEALER WON',
    'bj.anuncio_banca_bj': 'Dealer hit Blackjack',
    'bj.anuncio_banca_pts': 'Dealer: {p}',
    'bj.conf_todos_dev': 'Confirm all (DEV)',
    'salas.jogar_agora': 'PLAY NOW',
    'salas.jogar_agora_sub': 'Jump into an online table or play against bots',
    'salas.bots_ativados': 'Bots enabled',
    'salas.ja_titulo': 'Play Now',
    'salas.ja_desc': 'Choose how to start your Online Poker game:',
    'salas.ja_online': 'Join a match',
    'salas.ja_online_desc': 'Join an online table with real players',
    'salas.ja_solo': 'Play solo vs bots',
    'salas.ja_solo_desc': 'Quick private game against hybrid bots',
    'criar.bots': 'Fill with Bots',
    'criar.bots_off': 'Off',
    'criar.bots_on': 'On',
    'criar.bots_dica': 'Hybrid bots join and leave naturally and always make room for real players.',
    'mesa.rebuy_1': '1 stack',
    'mesa.rebuy_meio': '½ stack',
    'mesa.rebuy_quarto': '¼ stack',
    'mesa.espectar': 'Spectate',
    'mesa.espectando_rebuy': 'You are spectating. Buy chips to return to the table.',
    'mesa.espectando': 'You are spectating the table.',
    'mesa.sem_fichas_rebuy': 'You are out of chips. Rebuy or spectate the table.',
    'criar.privada': 'Room privacy',
    'criar.privada_off': 'Public',
    'criar.privada_on': 'Private (password)',
    'criar.tempo_curto': 'Turn time',
    'criar.blinds_curto': 'Raise blinds',
    'criar.bots_curto': 'Bots',
    'criar.privada_curto': 'Privacy',
    'criar.privada_on_curto': '🔒 Private',
    'criar.ph_senha': 'Enter room password',
    'criar.erro_senha': 'Enter a password for the private room.',
    'salas.privada': '🔒 Private',
    'salas.senha_titulo': 'Private room',
    'salas.senha_desc': 'Enter the password to join this table:',
    'salas.senha_ph': 'Room password',
    'salas.senha_entrar': 'Join table'
  }
};

export function t(chave, vars) {
  const dict = DICIONARIO[idiomaAtual] || DICIONARIO.pt;
  let txt = dict[chave] || DICIONARIO.pt[chave] || chave;
  if (vars) {
    for (const k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        txt = txt.split('{' + k + '}').join(String(vars[k]));
      }
    }
  }
  return txt;
}

export function aplicarIdiomaDOM() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = idiomaAtual === 'pt' ? 'pt-BR' : idiomaAtual;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n;
    if (k) el.textContent = t(k);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const k = el.dataset.i18nHtml;
    if (k) el.innerHTML = t(k);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const k = el.dataset.i18nPh;
    if (k) el.placeholder = t(k);
  });
  document.querySelectorAll('[data-termo]').forEach((el) => {
    const k = el.dataset.termo;
    if (k) el.textContent = termo(k);
  });

  document.querySelectorAll('.idioma-btn[data-lang]').forEach((b) => {
    const sel = b.dataset.lang === idiomaAtual;
    b.classList.toggle('sel', sel);
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    if (b.getAttribute('role') === 'option') {
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
  });

  const idiomaAtualEl = document.getElementById('idioma-perfil-atual');
  const idiomaOpcaoSel = document.querySelector('.idioma-btn.sel');
  if (idiomaAtualEl && idiomaOpcaoSel) {
    idiomaAtualEl.textContent = idiomaOpcaoSel.textContent;
  }

  const linhaTermos = document.getElementById('linha-termos-traduzidos');
  if (linhaTermos) linhaTermos.hidden = (idiomaAtual === 'en');

  const btnTermos = document.getElementById('btn-perfil-termos');
  if (btnTermos) {
    const ativo = termosTraduzidosAtivo();
    btnTermos.textContent = t(ativo ? 'estado.ativado' : 'estado.desativado');
    btnTermos.classList.toggle('ativo', ativo);
    btnTermos.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  }
}
