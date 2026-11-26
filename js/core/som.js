// Módulo unificado de áudio: 7 samples .mp3 (Kenney Casino Audio) + 6 sintetizadores via Web Audio API
// Inclui desbloqueio automático de AudioContext no primeiro toque/clique (iOS Safari, Android e PC) e mute salvo no localStorage.

const CHAVE_SOM = 'poker-som';

// Mapeamento dos arquivos reais na pasta sons/
const ARQUIVOS_MP3 = {
  'carta-dar':    { url: './sons/card-slide-1.mp3',   vol: 0.62, jitter: 0.04 },
  'carta-dar-2':  { url: './sons/card-slide-6.mp3',   vol: 0.62, jitter: 0.04 },
  'carta-virar':  { url: './sons/card-shove-1.mp3',   vol: 0.65, jitter: 0.03 },
  'entrar-sala':  { url: './sons/card-fan-1.mp3',     vol: 0.55, jitter: 0.02 },
  'embaralhar':   { url: './sons/oxidvideos-shuffling-deck-of-cards-522518.mp3', vol: 0.65, jitter: 0 },
  'ficha':        { url: './sons/chip-lay-1.mp3',     vol: 0.68, jitter: 0.05 },
  'allin':        { url: './sons/chips-stack-4.mp3',  vol: 0.82, jitter: 0 },
  'ganhar-pote':  { url: './sons/chips-handle-5.mp3', vol: 0.80, jitter: 0 }
};

let ctx = null;
let desbloqueado = false;
let precarregando = false;
const buffers = new Map();
const carregando = new Map();

let ativo = true;
let ultimaAcaoLocalEm = 0;
let ultimoCliqueEm = 0;
let ultimoSliderEm = 0;

// Botões que já têm som próprio (evita misturar o clique tátil com o som da jogada)
const SELETOR_SEM_CLIQUE = '#btn-desistir, #btn-check, #btn-pagar, #btn-confirmar-aposta, #btn-apostar, #btn-blind, #btn-som-mesa, #menu-btn-som, .carta-3d';

function escolherSomBotao(el) {
  if (!el || el.matches(SELETOR_SEM_CLIQUE)) return null;
  if (el.matches('.fechar, .voltar, #btn-voltar-mesa, #btn-confirmar-cancelar, .banner-convite-fechar')) return 'ui-fechar';
  if (el.matches('.perigo, .contorno-perigo, #btn-sair-mesa, #menu-btn-sair')) return 'ui-perigo';
  if (el.matches('.presets button, .passo, #btn-aumentar, .bj-ficha, .stack')) return 'ui-ficha';
  if (el.matches('.auth-aba, .perfil-aba, .amigos-aba, .chat-aba, .modo-btn, .cfg-tile')) return 'ui-tab';
  if (el.matches('.btn-pref-toggle, .tema-btn, .idioma-btn, .pill-toggle, .pill-real, .reacoes-emojis button, .reacoes-frases button, .chat-chip')) return 'ui-toggle';
  if (el.matches('.positivo, .cta-jogar-agora, #botao-login, #botao-criar, #btn-confirmar-ok, #botao-jogar, #btn-ja-online, #btn-ja-solo')) return 'ui-cta';
  if (el.matches('.icone-btn, .perfil-atalho, .btn-amigos-lobby, .sala, .perfil-select-btn, .tema-gatilho, .menu-tile, .social-item.clicavel, .lugar.clicavel-perfil')) return 'ui-menu';
  return 'clique';
}

function lerPreferenciaSom() {
  try { return localStorage.getItem(CHAVE_SOM) !== '0'; } catch (erro) { return true; }
}

function garantirContexto() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    ctx = new Ctx();
  } catch (erro) {
    return null;
  }
  return ctx;
}

// Decodifica um .mp3 com compatibilidade para Safari antigo (callback) e navegadores modernos (Promise)
function decodificarAudio(audioCtx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const ret = audioCtx.decodeAudioData(
        arrayBuffer,
        (decoded) => resolve(decoded),
        (err) => reject(err)
      );
      if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
    } catch (erro) {
      reject(erro);
    }
  });
}

function carregarBuffer(nome) {
  const cfg = ARQUIVOS_MP3[nome];
  if (!cfg) return Promise.resolve(null);
  if (buffers.has(nome)) return Promise.resolve(buffers.get(nome));
  if (carregando.has(nome)) return carregando.get(nome);

  const audioCtx = garantirContexto();
  if (!audioCtx) return Promise.resolve(null);

  const promessa = fetch(cfg.url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((ab) => (ab ? decodificarAudio(audioCtx, ab) : null))
    .then((buf) => {
      if (buf) buffers.set(nome, buf);
      carregando.delete(nome);
      return buf;
    })
    .catch(() => {
      carregando.delete(nome);
      return null;
    });

  carregando.set(nome, promessa);
  return promessa;
}

function precarregarTodos() {
  if (precarregando || !ativo) return;
  precarregando = true;
  const agendar = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
    : (fn) => setTimeout(fn, 150);
  const nomes = Object.keys(ARQUIVOS_MP3);
  nomes.forEach((nome, idx) => {
    agendar(() => { setTimeout(() => { if (ativo) carregarBuffer(nome); }, idx * 90); });
  });
}

// Desbloqueia Web Audio no primeiro gesto do usuário (exigência do Safari/iOS e Chrome Mobile)
function desbloquearAudio() {
  const audioCtx = garantirContexto();
  if (!audioCtx) return;

  if (audioCtx.state === 'suspended') {
    try { audioCtx.resume().catch(() => {}); } catch (erro) {}
  }

  if (!desbloqueado) {
    desbloqueado = true;
    try {
      const silencio = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = silencio;
      src.connect(audioCtx.destination);
      src.start(0);
    } catch (erro) {}
    if (ativo) precarregarTodos();
  }
}

function tocarBuffer(nome, atrasoSeg) {
  const audioCtx = garantirContexto();
  if (!audioCtx || audioCtx.state === 'suspended') return;
  const cfg = ARQUIVOS_MP3[nome];
  if (!cfg) return;

  const disparar = (buf) => {
    if (!buf || !ativo || !ctx) return;
    try {
      const inicio = ctx.currentTime + Math.max(0, atrasoSeg || 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (cfg.jitter > 0) {
        src.playbackRate.value = 1 + (Math.random() * 2 - 1) * cfg.jitter;
      }
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(cfg.vol, inicio);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(inicio);
    } catch (erro) {}
  };

  if (buffers.has(nome)) disparar(buffers.get(nome));
  else carregarBuffer(nome).then((buf) => { if (buf) disparar(buf); });
}

// =====================================================
// 6 SINTETIZADORES EM WEB AUDIO API PURA
// =====================================================

// 1) check: duas batidas graves e secas na madeira (140Hz–180Hz, decaimento 50ms, intervalo 130ms)
function synthCheck(audioCtx, t0) {
  [
    { dt: 0,    fIni: 176, fFim: 132, gain: 0.42 },
    { dt: 0.13, fIni: 162, fFim: 122, gain: 0.36 }
  ].forEach((b) => {
    const t = t0 + b.dt;
    // Corpo grave amadeirado
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(b.fIni, t);
    osc.frequency.exponentialRampToValueAtTime(b.fFim, t + 0.05);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(b.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.054);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.06);

    // Transiente seco de batida na mesa (curtíssimo, filtrado)
    const tap = audioCtx.createOscillator();
    const filtro = audioCtx.createBiquadFilter();
    const gTap = audioCtx.createGain();
    tap.type = 'sine';
    tap.frequency.setValueAtTime(340, t);
    tap.frequency.exponentialRampToValueAtTime(140, t + 0.018);
    filtro.type = 'lowpass';
    filtro.frequency.setValueAtTime(480, t);
    gTap.gain.setValueAtTime(0.18, t);
    gTap.gain.exponentialRampToValueAtTime(0.0008, t + 0.022);
    tap.connect(filtro);
    filtro.connect(gTap);
    gTap.connect(audioCtx.destination);
    tap.start(t);
    tap.stop(t + 0.028);
  });
}

// 2) sua-vez: chime suave ascendente (C5 -> G5 após 100ms, onda sine, fade-out rápido ~0.4s total)
function synthSuaVez(audioCtx, t0) {
  [
    { dt: 0,    freq: 523.25, dur: 0.24, gain: 0.18 }, // C5
    { dt: 0.10, freq: 783.99, dur: 0.30, gain: 0.20 }  // G5
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.freq, t);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.02);
  });
}

// 3) showdown: impacto curto de tensão (0.6s), sawtooth/triangle filtrada low-pass caindo 120Hz -> 40Hz
function synthShowdown(audioCtx, t0) {
  const dur = 0.6;
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const filtro = audioCtx.createBiquadFilter();
  const g = audioCtx.createGain();

  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(120, t0);
  osc1.frequency.exponentialRampToValueAtTime(40, t0 + dur);

  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(60, t0);
  osc2.frequency.exponentialRampToValueAtTime(32, t0 + dur);

  filtro.type = 'lowpass';
  filtro.Q.setValueAtTime(3.2, t0);
  filtro.frequency.setValueAtTime(260, t0);
  filtro.frequency.exponentialRampToValueAtTime(55, t0 + dur);

  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(0.32, t0 + 0.018);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

  osc1.connect(filtro);
  osc2.connect(filtro);
  filtro.connect(g);
  g.connect(audioCtx.destination);

  osc1.start(t0);
  osc2.start(t0);
  osc1.stop(t0 + dur + 0.03);
  osc2.stop(t0 + dur + 0.03);
}

// 4) tempo-urgente: tique-taque curto e seco (40ms) em 950Hz para os últimos 7s do timer
function synthTempoUrgente(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(980, t0);
  osc.frequency.exponentialRampToValueAtTime(900, t0 + 0.04);
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(0.14, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.04);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.045);
}

// 5) campeao: fanfarra curta (~1.8s) com arpejo ascendente maior (C5 - E5 - G5 - C6) e acorde sustentado
function synthCampeao(audioCtx, t0) {
  const notas = [
    { dt: 0.00, freq: 523.25, dur: 0.34, gain: 0.16 }, // C5
    { dt: 0.11, freq: 659.25, dur: 0.34, gain: 0.16 }, // E5
    { dt: 0.22, freq: 783.99, dur: 0.38, gain: 0.17 }, // G5
    // Acorde final sustentado (C5 + E5 + G5 + C6) fechando em ~1.8s
    { dt: 0.35, freq: 523.25, dur: 1.40, gain: 0.09 }, // C5
    { dt: 0.35, freq: 659.25, dur: 1.40, gain: 0.09 }, // E5
    { dt: 0.35, freq: 783.99, dur: 1.42, gain: 0.10 }, // G5
    { dt: 0.35, freq: 1046.5, dur: 1.45, gain: 0.16 }  // C6
  ];

  const filtro = audioCtx.createBiquadFilter();
  filtro.type = 'lowpass';
  filtro.frequency.setValueAtTime(2800, t0);
  filtro.connect(audioCtx.destination);

  notas.forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(n.freq, t);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.018);
    g.gain.setValueAtTime(n.gain * 0.85, t + Math.min(0.18, n.dur * 0.35));
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(filtro);
    osc.start(t);
    osc.stop(t + n.dur + 0.03);
  });
}

// 6) clique: pop/clique ultra-curto (30ms) e bem baixinho em 700Hz
function synthClique(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(700, t0);
  osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.03);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.075, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.03);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.035);
}

let noiseDesistirBuf = null;
let noiseDesistirCtx = null;

// 7) desistir: swoosh rápido descendente + duas notas graves suaves caindo (bem diferente de dar carta)
function synthDesistir(audioCtx, t0) {
  // Ruído filtrado simulando jogar as cartas no monte (buffer reutilizado por AudioContext)
  if (!noiseDesistirBuf || noiseDesistirCtx !== audioCtx) {
    noiseDesistirCtx = audioCtx;
    const tam = Math.floor(audioCtx.sampleRate * 0.16);
    noiseDesistirBuf = audioCtx.createBuffer(1, tam, audioCtx.sampleRate);
    const data = noiseDesistirBuf.getChannelData(0);
    for (let i = 0; i < tam; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / tam);
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseDesistirBuf;
  const filtro = audioCtx.createBiquadFilter();
  filtro.type = 'bandpass';
  filtro.Q.setValueAtTime(1.4, t0);
  filtro.frequency.setValueAtTime(1400, t0);
  filtro.frequency.exponentialRampToValueAtTime(320, t0 + 0.16);
  const gNoise = audioCtx.createGain();
  gNoise.gain.setValueAtTime(0.001, t0);
  gNoise.gain.linearRampToValueAtTime(0.18, t0 + 0.015);
  gNoise.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.16);
  noise.connect(filtro);
  filtro.connect(gNoise);
  gNoise.connect(audioCtx.destination);
  noise.start(t0);

  // Tom descendente suave (sinal claro de "fora da mão")
  [
    { dt: 0.02, freq: 311.13, dur: 0.14, gain: 0.14 }, // Eb4
    { dt: 0.10, freq: 220.00, dur: 0.22, gain: 0.15 }  // A3
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(n.freq, t);
    osc.frequency.exponentialRampToValueAtTime(n.freq * 0.92, t + n.dur);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.02);
  });
}

// 8) ui-cta: pop quente e ascendente para ações principais (Entrar, Jogar Agora, Confirmar)
function synthUiCta(audioCtx, t0) {
  [
    { dt: 0,     fIni: 500, fFim: 620, dur: 0.045, gain: 0.085 },
    { dt: 0.028, fIni: 660, fFim: 760, dur: 0.055, gain: 0.08 }
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.fIni, t);
    osc.frequency.exponentialRampToValueAtTime(n.fFim, t + n.dur);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.01);
  });
}

// 9) ui-tab: tick mecânico nítido e curto para abas e seletores
function synthUiTab(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1080, t0);
  osc.frequency.exponentialRampToValueAtTime(760, t0 + 0.022);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.075, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.024);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.03);
}

// 10) ui-fechar: pop suave descendente para fechar/voltar/cancelar
function synthUiFechar(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(560, t0);
  osc.frequency.exponentialRampToValueAtTime(340, t0 + 0.042);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.07, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.044);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.05);
}

// 11) ui-perigo: pulso grave firme para sair/remover/excluir
function synthUiPerigo(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(230, t0);
  osc.frequency.exponentialRampToValueAtTime(150, t0 + 0.06);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.11, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.062);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.07);
}

// 12) ui-ficha: clique cerâmico de ficha de poker (atalhos de aposta, +/-, stack)
function synthUiFicha(audioCtx, t0) {
  [
    { freq: 2150, gain: 0.055, dur: 0.022 },
    { freq: 3350, gain: 0.032, dur: 0.016 }
  ].forEach((h) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(h.freq, t0);
    osc.frequency.exponentialRampToValueAtTime(h.freq * 0.88, t0 + h.dur);
    g.gain.setValueAtTime(0.0008, t0);
    g.gain.linearRampToValueAtTime(h.gain, t0 + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + h.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + h.dur + 0.008);
  });
}

// 13) ui-menu: pop aveludado amadeirado para cards, salas, ícones de topo e perfis
function synthUiMenu(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, t0);
  osc.frequency.exponentialRampToValueAtTime(490, t0 + 0.034);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.08, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.036);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.042);
}

// 14) ui-toggle: bloop cristalino ascendente para toggles, temas, idiomas e reações
function synthUiToggle(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(780, t0);
  osc.frequency.exponentialRampToValueAtTime(1060, t0 + 0.036);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.07, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.038);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.045);
}

// 15) slider-tick: micro-catraca sutil ao arrastar o slider de aposta
function synthSliderTick(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1450, t0);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.04, t0 + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.014);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.02);
}

// 16) chat-msg: pop bolha suave para mensagens de chat
function synthChatMsg(audioCtx, t0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(540, t0);
  osc.frequency.exponentialRampToValueAtTime(720, t0 + 0.055);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.linearRampToValueAtTime(0.09, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.065);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.075);
}

// 17) reacao: sparkle curto divertido para reações rápidas
function synthReacao(audioCtx, t0) {
  [
    { dt: 0,     freq: 740,  dur: 0.06, gain: 0.075 },
    { dt: 0.045, freq: 988,  dur: 0.07, gain: 0.08 },
    { dt: 0.09,  freq: 1175, dur: 0.09, gain: 0.07 }
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.freq, t);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.01);
  });
}

// 18) convite-social: chime convidativo de 3 notas (E5 - G5 - B5)
function synthConviteSocial(audioCtx, t0) {
  [
    { dt: 0,    freq: 659.25, dur: 0.16, gain: 0.11 },
    { dt: 0.09, freq: 783.99, dur: 0.18, gain: 0.11 },
    { dt: 0.18, freq: 987.77, dur: 0.28, gain: 0.12 }
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.freq, t);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.02);
  });
}

// 19) notificacao: ping suave (G5 -> C6) para pedidos de amizade
function synthNotificacao(audioCtx, t0) {
  [
    { dt: 0,    freq: 783.99, dur: 0.14, gain: 0.10 },
    { dt: 0.08, freq: 1046.5, dur: 0.22, gain: 0.11 }
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.freq, t);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.02);
  });
}

// 20) sucesso: acorde leve ascendente (C5 - E5 - G5)
function synthSucesso(audioCtx, t0) {
  [
    { dt: 0,    freq: 523.25, dur: 0.14, gain: 0.09 },
    { dt: 0.06, freq: 659.25, dur: 0.16, gain: 0.095 },
    { dt: 0.12, freq: 783.99, dur: 0.24, gain: 0.10 }
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(n.freq, t);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + n.dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.02);
  });
}

// 21) erro: dois pulsos graves curtos
function synthErro(audioCtx, t0) {
  [
    { dt: 0,     freq: 210 },
    { dt: 0.095, freq: 165 }
  ].forEach((n) => {
    const t = t0 + n.dt;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(n.freq, t);
    osc.frequency.exponentialRampToValueAtTime(n.freq * 0.85, t + 0.075);
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  });
}

const SINTETIZADORES = {
  'check':          synthCheck,
  'desistir':       synthDesistir,
  'sua-vez':        synthSuaVez,
  'showdown':       synthShowdown,
  'tempo-urgente':  synthTempoUrgente,
  'campeao':        synthCampeao,
  'clique':         synthClique,
  'ui-cta':         synthUiCta,
  'ui-tab':         synthUiTab,
  'ui-fechar':      synthUiFechar,
  'ui-perigo':      synthUiPerigo,
  'ui-ficha':       synthUiFicha,
  'ui-menu':        synthUiMenu,
  'ui-toggle':      synthUiToggle,
  'slider-tick':    synthSliderTick,
  'chat-msg':       synthChatMsg,
  'reacao':         synthReacao,
  'convite-social': synthConviteSocial,
  'notificacao':    synthNotificacao,
  'sucesso':        synthSucesso,
  'erro':           synthErro
};

// =====================================================
// API PÚBLICA
// =====================================================

export function somAtivo() {
  return ativo;
}

export function marcarAcaoLocal() {
  ultimaAcaoLocalEm = Date.now();
}

export function foiAcaoLocalRecente() {
  return (Date.now() - ultimaAcaoLocalEm) < 1500;
}

export function tocarSom(nome, atrasoMs) {
  if (!ativo) return;
  if (nome === 'carta-dar' && Math.random() < 0.5) {
    nome = 'carta-dar-2';
  }
  if (nome === 'clique' || nome.startsWith('ui-')) {
    const agora = Date.now();
    if (agora - ultimoCliqueEm < 60) return;
    ultimoCliqueEm = agora;
  } else if (nome === 'slider-tick') {
    const agora = Date.now();
    if (agora - ultimoSliderEm < 48) return;
    ultimoSliderEm = agora;
  }
  const audioCtx = garantirContexto();
  if (!audioCtx) return;

  const atrasoSeg = Math.max(0, (Number(atrasoMs) || 0) / 1000);
  const executarSom = () => {
    if (!ativo || !ctx || ctx.state === 'suspended') return;
    if (ARQUIVOS_MP3[nome]) {
      tocarBuffer(nome, atrasoSeg);
      return;
    }
    const fn = SINTETIZADORES[nome];
    if (fn) {
      try { fn(ctx, ctx.currentTime + atrasoSeg); } catch (erro) {}
    }
  };

  if (audioCtx.state === 'suspended') {
    try { audioCtx.resume().then(executarSom).catch(() => {}); } catch (erro) {}
    return;
  }
  executarSom();
}

function atualizarBotoesSom() {
  const btnTopo = document.getElementById('btn-som-mesa');
  if (btnTopo) {
    btnTopo.textContent = ativo ? '🔊' : '🔇';
    btnTopo.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    btnTopo.title = ativo ? 'Som ligado (clique para silenciar)' : 'Som silenciado (clique para ativar)';
    btnTopo.classList.toggle('mutado', !ativo);
  }
  const btnMenu = document.getElementById('menu-btn-som');
  if (btnMenu) {
    btnMenu.textContent = ativo ? '🔊 Som: Ligado' : '🔇 Som: Mudo';
    btnMenu.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  }
}

export function alternarSom() {
  desbloquearAudio();
  ativo = !ativo;
  try { localStorage.setItem(CHAVE_SOM, ativo ? '1' : '0'); } catch (erro) {}
  atualizarBotoesSom();
  if (ativo) {
    precarregarTodos();
    tocarSom('sucesso');
  }
}

export function iniciarSom() {
  ativo = lerPreferenciaSom();
  atualizarBotoesSom();

  const aoPrimeiroGesto = () => {
    desbloquearAudio();
  };
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => {
    document.addEventListener(ev, aoPrimeiroGesto, { passive: true, once: true });
  });

  // Feedback tátil diferenciado em todos os botões e cards clicáveis da interface
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest
      ? e.target.closest('button:not(:disabled), .social-item.clicavel, .lugar.clicavel-perfil')
      : null;
    if (!btn) return;
    const som = escolherSomBotao(btn);
    if (som) tocarSom(som);
  }, { passive: true });

  // Catraca sutil ao arrastar sliders de aposta
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.tagName === 'INPUT' && el.type === 'range') {
      tocarSom('slider-tick');
    }
  }, { passive: true });
}
