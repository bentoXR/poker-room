// Internacionalização (PT-BR, ES, EN) e preferência de termos de poker em inglês vs. traduzidos
const CHAVE_IDIOMA = 'poker-idioma';
const CHAVE_TERMOS_TRADUZIDOS = 'poker-termos-traduzidos';

let idiomaAtual = lerIdiomaSalvo();
let termosTraduzidos = lerTermosTraduzidosSalvo();
let hookAoMudar = null;

function lerIdiomaSalvo() {
  try {
    const v = localStorage.getItem(CHAVE_IDIOMA);
    if (v === 'pt' || v === 'es' || v === 'en') return v;
  } catch (e) {}
  return 'pt';
}

function lerTermosTraduzidosSalvo() {
  try {
    return localStorage.getItem(CHAVE_TERMOS_TRADUZIDOS) === '1';
  } catch (e) {}
  return false; // Padrão: termos de poker em inglês
}

export function registrarHookIdioma(fn) {
  hookAoMudar = fn;
}

export function obterIdioma() {
  return idiomaAtual;
}

export function termosTraduzidosAtivo() {
  return idiomaAtual !== 'en' && termosTraduzidos;
}

export function escolherIdioma(lang) {
  if (lang !== 'pt' && lang !== 'es' && lang !== 'en') return;
  idiomaAtual = lang;
  try { localStorage.setItem(CHAVE_IDIOMA, lang); } catch (e) {}
  aplicarIdiomaDOM();
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
  bigblind:   { en: 'Big Blind',   pt: 'Cego Grande',   es: 'Ciega Grande' }
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
    'salas.titulo': 'Salas abertas',
    'salas.sub': 'Entre em uma mesa ou <strong>crie a sua</strong> em segundos.',
    'salas.criar': '+ Criar sala',
    'salas.buscando': 'Buscando salas abertas…',
    'salas.vazio': 'Nenhuma sala aberta agora',
    'criar.titulo': 'Nova sala',
    'criar.nome_sala': 'Nome da sala',
    'criar.modo': 'Escolha o modo de jogo',
    'criar.fichas': 'Fichas iniciais',
    'criar.botao': 'Criar sala e abrir mesa',
    'criar.tempo': 'Tempo por jogada',
    'criar.subir_blinds': 'Subir blinds automaticamente',
    'criar.aposta_min': 'Aposta mínima (Blackjack)',
    'perfil.titulo': 'Meu perfil',
    'perfil.prefs': 'Preferências da mesa',
    'perfil.tema': 'Tema visual',
    'perfil.idioma': 'Idioma',
    'perfil.termos_titulo': 'Traduzir termos do poker',
    'perfil.termos_desc': 'Por padrão, termos como Raise, Call, Check, Fold, Stack e Pot ficam em inglês.',
    'perfil.espiar_titulo': 'Segurar para espiar cartas',
    'perfil.espiar_desc': 'Quando ativo, suas cartas só aparecem enquanto você segura o dedo (ou Espaço no PC)',
    'perfil.seguranca': 'Segurança da conta',
    'estado.ativado': 'Ativado',
    'estado.desativado': 'Desativado',
    'mesa.aguardando': 'Aguardando jogadores…',
    'mesa.sua_vez': 'Sua vez de jogar!',
    'mesa.vez_de': 'Vez de {nome}',
    'mesa.rodada': 'Rodada {n}',
    'mesa.mao': 'Mão {n}',
    'bj.pedir': 'Pedir',
    'bj.parar': 'Parar',
    'bj.dobrar': 'Dobrar',
    'bj.dividir': 'Dividir',
    'bj.apostar': 'Apostar {v}'
  },
  es: {
    'app.entrar': 'Entrar',
    'app.criar_conta': 'Crear cuenta',
    'app.sair': 'Salir',
    'app.voltar': 'Volver',
    'salas.titulo': 'Salas abiertas',
    'salas.sub': 'Entra a una mesa o <strong>crea la tuya</strong> en segundos.',
    'salas.criar': '+ Crear sala',
    'salas.buscando': 'Buscando salas abiertas…',
    'salas.vazio': 'No hay salas abiertas ahora',
    'criar.titulo': 'Nueva sala',
    'criar.nome_sala': 'Nombre de la sala',
    'criar.modo': 'Elige el modo de juego',
    'criar.fichas': 'Fichas iniciales',
    'criar.botao': 'Crear sala y abrir mesa',
    'criar.tempo': 'Tiempo por turno',
    'criar.subir_blinds': 'Subir ciegas automáticamente',
    'criar.aposta_min': 'Apuesta mínima (Blackjack)',
    'perfil.titulo': 'Mi perfil',
    'perfil.prefs': 'Preferencias de la mesa',
    'perfil.tema': 'Tema visual',
    'perfil.idioma': 'Idioma',
    'perfil.termos_titulo': 'Traducir términos del póker',
    'perfil.termos_desc': 'Por defecto, términos como Raise, Call, Check, Fold, Stack y Pot se mantienen en inglés.',
    'perfil.espiar_titulo': 'Mantener para ver cartas',
    'perfil.espiar_desc': 'Cuando está activo, tus cartas solo se ven mientras mantienes pulsado (o Espacio en PC)',
    'perfil.seguranca': 'Seguridad de la cuenta',
    'estado.ativado': 'Activado',
    'estado.desativado': 'Desactivado',
    'mesa.aguardando': 'Esperando jugadores…',
    'mesa.sua_vez': '¡Tu turno!',
    'mesa.vez_de': 'Turno de {nome}',
    'mesa.rodada': 'Ronda {n}',
    'mesa.mao': 'Mano {n}',
    'bj.pedir': 'Pedir',
    'bj.parar': 'Plantarse',
    'bj.dobrar': 'Doblar',
    'bj.dividir': 'Dividir',
    'bj.apostar': 'Apostar {v}'
  },
  en: {
    'app.entrar': 'Sign in',
    'app.criar_conta': 'Create account',
    'app.sair': 'Sign out',
    'app.voltar': 'Back',
    'salas.titulo': 'Open rooms',
    'salas.sub': 'Join a table or <strong>create yours</strong> in seconds.',
    'salas.criar': '+ Create room',
    'salas.buscando': 'Looking for open rooms…',
    'salas.vazio': 'No open rooms right now',
    'criar.titulo': 'New room',
    'criar.nome_sala': 'Room name',
    'criar.modo': 'Choose game mode',
    'criar.fichas': 'Starting stack',
    'criar.botao': 'Create room and open table',
    'criar.tempo': 'Turn timer',
    'criar.subir_blinds': 'Auto-raise blinds',
    'criar.aposta_min': 'Minimum bet (Blackjack)',
    'perfil.titulo': 'My profile',
    'perfil.prefs': 'Table preferences',
    'perfil.tema': 'Visual theme',
    'perfil.idioma': 'Language',
    'perfil.termos_titulo': 'Translate poker terms',
    'perfil.termos_desc': 'In English, all poker terms are already in English.',
    'perfil.espiar_titulo': 'Hold to peek cards',
    'perfil.espiar_desc': 'When enabled, your cards only show while holding (or Spacebar on PC)',
    'perfil.seguranca': 'Account security',
    'estado.ativado': 'Enabled',
    'estado.desativado': 'Disabled',
    'mesa.aguardando': 'Waiting for players…',
    'mesa.sua_vez': 'Your turn!',
    'mesa.vez_de': '{nome}\'s turn',
    'mesa.rodada': 'Round {n}',
    'mesa.mao': 'Hand {n}',
    'bj.pedir': 'Hit',
    'bj.parar': 'Stand',
    'bj.dobrar': 'Double',
    'bj.dividir': 'Split',
    'bj.apostar': 'Bet {v}'
  }
};

export function t(chave, vars) {
  const dict = DICIONARIO[idiomaAtual] || DICIONARIO.pt;
  let txt = dict[chave] || DICIONARIO.pt[chave] || chave;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      txt = txt.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
    });
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
  document.querySelectorAll('[data-termo]').forEach((el) => {
    const k = el.dataset.termo;
    if (k) el.textContent = termo(k);
  });

  // Atualiza seletor de idioma no perfil
  document.querySelectorAll('.idioma-btn[data-lang]').forEach((b) => {
    const sel = b.dataset.lang === idiomaAtual;
    b.classList.toggle('sel', sel);
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
  });

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
