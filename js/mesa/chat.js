// Chat da mesa (Supabase + Realtime), indicador de digitação, atalhos rápidos e votação por maioria (sem anfitrião)
import { banco } from '../core/supabase.js?v=107';
import { estado, nomeDe } from '../core/estado.js?v=107';
import { $id, escapar, aviso, abrirFolha, limparErro } from '../core/ui.js?v=120';
import { publicarChat, publicarReacao, publicarDigitando } from '../core/realtime.js?v=119';
import { tocarSom } from '../core/som.js?v=123';
import { executar } from './apostas.js?v=107';

const JANELA_DIGITANDO_MS = 3400;
const COOLDOWN_CHAT_MS = 1200;
const JANELA_RAJADA_CHAT_MS = 10000;
const MAX_RAJADA_CHAT = 5;
const COOLDOWN_SOM_CHAT_MS = 1000;
const COOLDOWN_PREVIEW_AUTOR_MS = 1200;

const chat = {
  partidaId: null,
  mensagens: [],
  ids: new Set(),
  naoLidas: 0,
  enviando: false,
  sujo: false,
  ultimaReacaoEm: 0,
  ultimoEnvioEm: 0,
  enviosRecentes: [],
  timerCooldown: null,
  ultimoSomEm: 0,
  ultimoPreviewPor: new Map(),
  abaAtual: 'chat',
  digitandoPor: new Map(),
  ultimoSinalDigitar: 0,
  timerDigitando: null,
  votacaoVistaId: null
};

function chatAberto() {
  const el = $id('folha-chat');
  return Boolean(el && !el.hidden);
}

function modoOnlineAtivo() {
  return Boolean(estado.partidaAtual && estado.partidaAtual.modo === 'online' && !estado.partidaAtual.encerrada);
}

function segundosRestantesVotacao(v) {
  if (!v || !v.expira_em) return 0;
  const exp = Date.parse(v.expira_em);
  if (Number.isNaN(exp)) return 0;
  return Math.max(0, Math.ceil((exp - (Date.now() + (estado.relogio.offset || 0))) / 1000));
}

function votacaoAtiva() {
  const p = estado.partidaAtual;
  if (!p || p.modo !== 'online' || p.encerrada || !p.votacao) return null;
  if (segundosRestantesVotacao(p.votacao) <= 0) return null;
  return p.votacao;
}

function meuVotoAtual(v) {
  if (!v || !v.votos || !estado.meuJogadorId) return null;
  if (!Object.prototype.hasOwnProperty.call(v.votos, estado.meuJogadorId)) return null;
  return Boolean(v.votos[estado.meuJogadorId]);
}

function euNaMesa() {
  if (!estado.meuJogadorId || !estado.meuSegredo) return null;
  return (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId) || null;
}

function votacaoAguardandoMeuVoto() {
  const v = votacaoAtiva();
  if (!v || !euNaMesa()) return false;
  return meuVotoAtual(v) === null;
}

function descreverVotacao(v) {
  if (!v) return '';
  if (v.tipo === 'pausar') return 'Pausar a mesa';
  if (v.tipo === 'retomar') return 'Retomar a mesa';
  if (v.tipo === 'rabbit_on') return 'Ativar Rabbit Hunt (ver cartas)';
  if (v.tipo === 'rabbit_off') return 'Desativar Rabbit Hunt (ver cartas)';
  if (v.tipo === 'expulsar') return 'Remover ' + nomeDe(v.alvo_nome || 'jogador');
  return 'Votação da mesa';
}

function atualizarBadge() {
  const badge = $id('badge-chat');
  const pendenteVoto = votacaoAguardandoMeuVoto();
  if (badge) {
    if (chat.naoLidas > 0) {
      badge.textContent = chat.naoLidas > 9 ? '9+' : String(chat.naoLidas);
      badge.classList.remove('voto');
      badge.classList.add('pulsa');
      badge.hidden = false;
    } else if (pendenteVoto) {
      badge.textContent = '!';
      badge.classList.add('voto', 'pulsa');
      badge.hidden = false;
    } else {
      badge.textContent = '';
      badge.classList.remove('pulsa', 'voto');
      badge.hidden = true;
    }
  }

  const badgeAba = $id('badge-aba-voto');
  const v = votacaoAtiva();
  if (badgeAba) {
    if (v) {
      badgeAba.textContent = pendenteVoto ? 'Votar' : ((v.sim || 1) + '/' + (v.necessarios || 1));
      badgeAba.classList.toggle('pendente', pendenteVoto);
      badgeAba.hidden = false;
    } else {
      badgeAba.textContent = '';
      badgeAba.classList.remove('pendente');
      badgeAba.hidden = true;
    }
  }
}

function meuAutorKey() {
  if (estado.meuJogadorId) return String(estado.meuJogadorId);
  if (estado.minhaConta && estado.minhaConta.id) return String(estado.minhaConta.id);
  return '';
}

function meuNomeAutor() {
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (eu && eu.nome) return eu.nome;
  if (estado.minhaConta && estado.minhaConta.nome) return estado.minhaConta.nome;
  return 'Jogador';
}

const FMT_HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function formatarHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return FMT_HORA.format(d);
}

function ehMinhaMensagem(msg) {
  if (!msg || !msg.autor_id) return false;
  if (estado.meuJogadorId && msg.autor_id === estado.meuJogadorId) return true;
  if (estado.minhaConta && msg.autor_id === estado.minhaConta.id) return true;
  return false;
}

function rolarFim() {
  const lista = $id('chat-lista');
  if (lista) lista.scrollTop = lista.scrollHeight;
}

function htmlMensagemChat(m) {
  const minha = ehMinhaMensagem(m);
  const autor = escapar(nomeDe(m.autor_nome || 'Jogador'));
  const texto = escapar(m.texto || '');
  const hora = formatarHora(m.criado_em);
  return (
    '<div class="chat-msg' + (minha ? ' eu' : '') + '">' +
      '<div class="chat-cab">' +
        '<strong class="chat-autor">' + autor + '</strong>' +
        (hora ? '<span class="chat-hora">' + hora + '</span>' : '') +
      '</div>' +
      '<div class="chat-txt">' + texto + '</div>' +
    '</div>'
  );
}

function desenharChat() {
  if (!chatAberto() || chat.abaAtual !== 'chat') {
    chat.sujo = true;
    return;
  }
  chat.sujo = false;
  const lista = $id('chat-lista');
  if (!lista) return;

  if (!chat.mensagens.length) {
    lista.innerHTML =
      '<div class="chat-vazio">Nenhuma mensagem ainda. Mande um oi ou use um atalho abaixo!</div>';
    return;
  }

  lista.innerHTML = chat.mensagens.map(htmlMensagemChat).join('');

  rolarFim();
}

function limparPreviewChat() {
  const wrap = $id('chat-preview');
  if (wrap) wrap.innerHTML = '';
}

function limparFlutuantesPerfil() {
  const camada = $id('camada-flutuantes');
  if (camada) camada.innerHTML = '';
}

function encontrarAncoraPerfil(jogadorId, autorId, autorNome) {
  const jogadores = estado.jogadoresAtuais || [];
  let jogador = null;
  if (jogadorId) {
    jogador = jogadores.find((j) => j.id === jogadorId) || null;
  }
  if (!jogador && autorId) {
    jogador = jogadores.find((j) => j.id === autorId || j.conta_id === autorId) || null;
  }
  if (!jogador && autorNome) {
    const alvo = String(autorNome).trim().toLowerCase();
    if (alvo) {
      jogador = jogadores.find((j) => String(j.nome || '').trim().toLowerCase() === alvo) || null;
    }
  }
  if (!jogador) return null;

  const dock = $id('meu-perfil-dock');
  if (dock && !dock.hidden && dock.dataset.jogadorId === jogador.id) {
    return dock.querySelector('.l-avatar, .ficha') || dock;
  }
  const assento = document.querySelector('#lista-jogadores .lugar[data-jogador-id="' + jogador.id + '"]');
  if (assento) {
    return assento.querySelector('.l-avatar, .ficha') || assento;
  }
  return null;
}

function lancarFlutuantePerfil({ ancoraEl, textoHtml, classeExtra, ariaLabel, onClick, duracaoMs = 3200 }) {
  const camada = $id('camada-flutuantes');
  if (!camada || !ancoraEl) return false;

  const rect = ancoraEl.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return false;

  const item = document.createElement(onClick ? 'button' : 'div');
  if (onClick) item.type = 'button';
  item.className = 'perfil-flutuante' + (classeExtra ? ' ' + classeExtra : '');
  if (ariaLabel) item.setAttribute('aria-label', ariaLabel);
  item.innerHTML = textoHtml;
  if (onClick) item.addEventListener('click', onClick);

  const margemX = classeExtra && classeExtra.includes('emoji') ? 28 : 96;
  const cx = Math.max(margemX, Math.min(window.innerWidth - margemX, rect.left + rect.width / 2));
  const cy = Math.max(44, rect.top + Math.min(12, rect.height * 0.25));
  const dx = Math.round((Math.random() * 28) - 14);

  item.style.left = cx + 'px';
  item.style.top = cy + 'px';
  item.style.setProperty('--dx', dx + 'px');
  item.style.setProperty('--dur', duracaoMs + 'ms');

  camada.appendChild(item);
  while (camada.children.length > 6) {
    camada.removeChild(camada.firstElementChild);
  }

  let removido = false;
  const remover = () => {
    if (removido) return;
    removido = true;
    if (item.isConnected) item.remove();
  };
  item.addEventListener('animationend', remover, { once: true });
  setTimeout(remover, duracaoMs + 180);
  return true;
}

function adicionarBannerPreview({ textoHtml, ariaLabel, classeExtra, onClick, duracaoMs = 3600 }) {
  const wrap = $id('chat-preview');
  if (!wrap) return;

  const item = document.createElement(onClick ? 'button' : 'div');
  if (onClick) item.type = 'button';
  item.className = 'chat-preview-item' + (classeExtra ? ' ' + classeExtra : '');
  if (ariaLabel) item.setAttribute('aria-label', ariaLabel);
  item.innerHTML = textoHtml;
  if (onClick) item.addEventListener('click', onClick);

  wrap.appendChild(item);
  while (wrap.children.length > 4) {
    wrap.removeChild(wrap.firstElementChild);
  }

  setTimeout(() => {
    if (!item.isConnected) return;
    item.classList.add('saindo');
    setTimeout(() => {
      if (item.isConnected) item.remove();
    }, 520);
  }, duracaoMs);
}

function mostrarPreviewChat(msg) {
  if (!msg) return;
  const autor = escapar(nomeDe(msg.autor_nome || 'Jogador'));
  const texto = escapar(msg.texto || '');
  const ancora = encontrarAncoraPerfil(null, msg.autor_id, msg.autor_nome);
  if (ancora && lancarFlutuantePerfil({
    ancoraEl: ancora,
    classeExtra: 'msg',
    textoHtml: '<span class="perfil-flutuante-autor">' + autor + ':</span> ' + texto,
    ariaLabel: 'Abrir chat: ' + nomeDe(msg.autor_nome || 'Jogador') + ' disse ' + (msg.texto || ''),
    onClick: () => abrirChat('chat'),
    duracaoMs: 3600
  })) {
    return;
  }

  adicionarBannerPreview({
    textoHtml: '<strong class="chat-preview-autor">' + autor + '</strong> <span class="chat-preview-txt">' + texto + '</span>',
    ariaLabel: 'Abrir chat: ' + nomeDe(msg.autor_nome || 'Jogador') + ' disse ' + (msg.texto || ''),
    onClick: () => abrirChat('chat'),
    duracaoMs: 3800
  });
}

function mostrarPreviewReacao(payload) {
  if (!payload || !payload.texto) return;
  const autor = escapar(nomeDe(payload.autor_nome || 'Jogador'));
  const texto = escapar(payload.texto);
  const ehEmoji = payload.texto.length <= 3;
  const ancora = encontrarAncoraPerfil(payload.jogador_id, null, payload.autor_nome);
  if (ancora && lancarFlutuantePerfil({
    ancoraEl: ancora,
    classeExtra: ehEmoji ? 'emoji' : 'frase',
    textoHtml: texto,
    ariaLabel: nomeDe(payload.autor_nome || 'Jogador') + ' reagiu: ' + payload.texto,
    duracaoMs: ehEmoji ? 2600 : 3200
  })) {
    return;
  }

  adicionarBannerPreview({
    classeExtra: 'reacao' + (ehEmoji ? ' emoji' : ''),
    textoHtml: (ehEmoji ? '<span class="chat-preview-emoji">' + texto + '</span>' : '') +
      '<strong class="chat-preview-autor">' + autor + '</strong>' +
      (ehEmoji ? '' : ' <span class="chat-preview-txt">' + texto + '</span>'),
    ariaLabel: nomeDe(payload.autor_nome || 'Jogador') + ' reagiu: ' + payload.texto,
    duracaoMs: 2800
  });
}

function mostrarPreviewVotacao(v) {
  if (!v) return;
  const titulo = escapar(descreverVotacao(v));
  const autor = escapar(nomeDe(v.autor_nome || 'Jogador'));
  adicionarBannerPreview({
    classeExtra: 'voto',
    textoHtml: '<strong class="chat-preview-autor">🗳 Votação (' + autor + ')</strong> <span class="chat-preview-txt">' + titulo + ' · Toque para votar</span>',
    ariaLabel: 'Abrir votação: ' + descreverVotacao(v),
    onClick: () => abrirChat('votacao'),
    duracaoMs: 7500
  });
}

function atualizarDigitandoUI() {
  const agora = Date.now();
  for (const [k, info] of chat.digitandoPor.entries()) {
    if (!info || info.expira <= agora) chat.digitandoPor.delete(k);
  }

  const nomes = Array.from(chat.digitandoPor.values()).map((info) => nomeDe(info.nome || 'Jogador'));
  const el = $id('chat-digitando');
  const btnChat = $id('btn-chat');

  if (btnChat) btnChat.classList.toggle('digitando', nomes.length > 0 && !chatAberto());
  if (el) {
    if (nomes.length === 0) {
      el.hidden = true;
      el.textContent = '';
    } else if (nomes.length === 1) {
      el.hidden = false;
      el.textContent = nomes[0] + ' está digitando…';
    } else if (nomes.length === 2) {
      el.hidden = false;
      el.textContent = nomes[0] + ' e ' + nomes[1] + ' estão digitando…';
    } else {
      el.hidden = false;
      el.textContent = nomes.length + ' pessoas digitando…';
    }
  }

  clearTimeout(chat.timerDigitando);
  chat.timerDigitando = null;
  if (chat.digitandoPor.size > 0) {
    let menorRestante = JANELA_DIGITANDO_MS;
    for (const info of chat.digitandoPor.values()) {
      menorRestante = Math.min(menorRestante, Math.max(250, info.expira - agora));
    }
    chat.timerDigitando = setTimeout(atualizarDigitandoUI, menorRestante + 40);
  }
}

export function aoDigitarChat() {
  if (!estado.partidaAtual || !chat.partidaId) return;
  const campo = $id('campo-chat');
  const ativo = Boolean(campo && campo.value.trim().length > 0);
  const agora = Date.now();
  if (ativo && agora - chat.ultimoSinalDigitar < 1600) return;
  chat.ultimoSinalDigitar = agora;

  publicarDigitando({
    partida_id: estado.partidaAtual.id,
    jogador_key: meuAutorKey(),
    autor_nome: meuNomeAutor(),
    ativo
  });
}

export function receberDigitando(payload) {
  if (!payload || !chat.partidaId) return;
  if (payload.partida_id && estado.partidaAtual && payload.partida_id !== estado.partidaAtual.id) return;
  const key = payload.jogador_key ? String(payload.jogador_key) : ('nome:' + String(payload.autor_nome || ''));
  if (key && key === meuAutorKey()) return;

  if (payload.ativo) {
    chat.digitandoPor.set(key, {
      nome: payload.autor_nome || 'Jogador',
      expira: Date.now() + JANELA_DIGITANDO_MS
    });
  } else {
    chat.digitandoPor.delete(key);
  }
  atualizarDigitandoUI();
}

export function escolherAbaChat(aba) {
  const online = modoOnlineAtivo();
  const alvo = aba === 'log'
    ? 'log'
    : ((online && aba === 'votacao') ? 'votacao' : 'chat');
  chat.abaAtual = alvo;
  limparErro('erro-votacao');

  const abas = $id('chat-abas');
  if (abas) abas.hidden = false;

  const btnChat = $id('aba-btn-chat');
  const btnVoto = $id('aba-btn-votacao');
  const btnLog = $id('aba-btn-log');
  const pChat = $id('aba-chat');
  const pVoto = $id('aba-votacao');
  const pLog = $id('aba-log');

  if (btnChat) {
    btnChat.classList.toggle('ativa', alvo === 'chat');
    btnChat.setAttribute('aria-selected', alvo === 'chat' ? 'true' : 'false');
  }
  if (btnVoto) {
    btnVoto.hidden = !online;
    btnVoto.classList.toggle('ativa', alvo === 'votacao');
    btnVoto.setAttribute('aria-selected', alvo === 'votacao' ? 'true' : 'false');
  }
  if (btnLog) {
    btnLog.classList.toggle('ativa', alvo === 'log');
    btnLog.setAttribute('aria-selected', alvo === 'log' ? 'true' : 'false');
  }
  if (pChat) pChat.hidden = alvo !== 'chat';
  if (pVoto) pVoto.hidden = alvo !== 'votacao';
  if (pLog) pLog.hidden = alvo !== 'log';

  if (alvo === 'chat') {
    chat.naoLidas = 0;
    atualizarBadge();
    if (chat.sujo) desenharChat();
    requestAnimationFrame(rolarFim);
  } else if (alvo === 'votacao') {
    desenharPainelVotacao();
  }
}

function desenharCardVotacaoAtiva() {
  const card = $id('votacao-ativa-card');
  if (!card) return;
  const v = votacaoAtiva();
  if (!v) {
    card.hidden = true;
    card.innerHTML = '';
    return;
  }

  const restante = segundosRestantesVotacao(v);
  const sim = Number(v.sim) || 0;
  const nao = Number(v.nao) || 0;
  const nec = Math.max(1, Number(v.necessarios) || 1);
  const eleg = Math.max(1, Number(v.elegiveis) || 1);
  const pct = Math.min(100, Math.round((sim / nec) * 100));
  const meuVoto = meuVotoAtual(v);
  const sentado = Boolean(euNaMesa());

  let acoesHtml = '';
  if (sentado) {
    acoesHtml =
      '<div class="votacao-acoes">'
      + '<button type="button" class="positivo' + (meuVoto === true ? ' votado' : '') + '" onclick="enviarVoto(true)">'
      +   (meuVoto === true ? '✓ Você votou Sim' : '✓ Sim')
      + '</button>'
      + '<button type="button" class="contorno-perigo' + (meuVoto === false ? ' votado' : '') + '" onclick="enviarVoto(false)">'
      +   (meuVoto === false ? '✕ Você votou Não' : '✕ Não')
      + '</button>'
      + '</div>';
  } else {
    acoesHtml = '<div class="votacao-nota">Apenas jogadores na mesa podem votar.</div>';
  }

  card.innerHTML =
    '<div class="votacao-topo">'
    + '<span class="votacao-tag">🗳 Votação aberta</span>'
    + '<span class="votacao-tempo" data-contagem-votacao>' + restante + 's</span>'
    + '</div>'
    + '<div class="votacao-titulo">' + escapar(descreverVotacao(v)) + '</div>'
    + '<div class="votacao-sub">Proposta por <strong>' + escapar(nomeDe(v.autor_nome || 'Jogador')) + '</strong> · Maioria: ' + nec + ' de ' + eleg + '</div>'
    + '<div class="votacao-barra"><div class="votacao-barra-fill" style="width:' + pct + '%"></div></div>'
    + '<div class="votacao-placar">'
    +   '<span>✓ ' + sim + ' Sim</span>'
    +   '<span>✕ ' + nao + ' Não</span>'
    + '</div>'
    + acoesHtml;
  card.hidden = false;
}

function desenharPainelVotacao() {
  const el = $id('painel-votacao');
  if (!el) return;
  const p = estado.partidaAtual;
  if (!p || p.modo !== 'online') {
    el.innerHTML = '';
    return;
  }

  const eu = euNaMesa();
  if (!eu) {
    el.innerHTML = '<div class="votacao-info">Entre na mesa como jogador para propor pausas ou remoções por votação.</div>';
    return;
  }

  const vAtiva = votacaoAtiva();
  const bloqueado = Boolean(vAtiva);
  const jogadores = estado.jogadoresAtuais || [];
  const outros = jogadores.filter((j) => j.id !== eu.id);
  const podeExpulsarQtd = jogadores.length >= 3;

  const tipoMesa = p.pausada ? 'retomar' : 'pausar';
  const iconeMesa = p.pausada ? '▶' : '⏸';
  const tituloMesa = p.pausada ? 'Retomar mesa' : 'Pausar mesa';
  const subMesa = p.pausada ? 'Mesa pausada' : 'Propor pausa';
  const classeMesa = p.pausada ? 'positivo' : 'secundario';

  const rabbitAtivo = !!p.rabbit_hunt_ativo;
  const tipoRabbit = rabbitAtivo ? 'rabbit_off' : 'rabbit_on';
  const tituloRabbit = rabbitAtivo ? 'Desativar Rabbit Hunt' : 'Ativar Rabbit Hunt';
  const subRabbit = rabbitAtivo ? 'Ativado · ver cartas' : 'Desativado · ver cartas';

  const listaJog = outros.length
    ? outros.map((j) => (
        '<div class="votacao-jogador">'
        + '<div class="votacao-jog-info">'
        +   '<strong>' + escapar(nomeDe(j.nome)) + '</strong>'
        +   '<small>' + j.saldo + ' fichas' + (j.ausente ? ' · ausente' : '') + '</small>'
        + '</div>'
        + '<button type="button" class="contorno-perigo" onclick="iniciarVotacao(\'expulsar\', \'' + j.id + '\')"'
        +   ((bloqueado || !podeExpulsarQtd) ? ' disabled' : '') + '>Votar remoção</button>'
        + '</div>'
      )).join('')
    : '<div class="votacao-info">Nenhum outro jogador sentado na mesa agora.</div>';

  el.innerHTML =
    '<div class="votacao-info">Sem anfitrião: decisões da sala funcionam por <strong>maioria simples</strong> (metade + 1 dos jogadores, 60s para votar).</div>'
    + (bloqueado ? '<div class="votacao-aviso">Há uma votação aberta acima. Aguarde concluir para iniciar outra.</div>' : '')
    + '<div class="votacao-bloco">'
    +   '<div class="votacao-sec-titulo">Controle da partida</div>'
    +   '<div class="votacao-grade-acoes">'
    +     '<button type="button" class="votacao-card-btn ' + classeMesa + '" onclick="iniciarVotacao(\'' + tipoMesa + '\')"' + (bloqueado ? ' disabled' : '') + '>'
    +       '<span class="vc-ico" aria-hidden="true">' + iconeMesa + '</span>'
    +       '<strong>' + tituloMesa + '</strong>'
    +       '<small>' + subMesa + '</small>'
    +     '</button>'
    +     '<button type="button" class="votacao-card-btn secundario' + (rabbitAtivo ? ' ativo' : '') + '" onclick="iniciarVotacao(\'' + tipoRabbit + '\')"' + (bloqueado ? ' disabled' : '') + '>'
    +       '<span class="vc-ico" aria-hidden="true">🐰</span>'
    +       '<strong>' + tituloRabbit + '</strong>'
    +       '<small>' + subRabbit + '</small>'
    +     '</button>'
    +   '</div>'
    + '</div>'
    + '<div class="votacao-bloco">'
    +   '<div class="votacao-sec-titulo">Remover jogador' + (podeExpulsarQtd ? '' : ' <small>(mín. 3 na mesa)</small>') + '</div>'
    +   listaJog
    + '</div>';
}

export function atualizarVotacaoUI() {
  const v = votacaoAtiva();
  if (v && v.id && v.id !== chat.votacaoVistaId) {
    chat.votacaoVistaId = v.id;
    if (!chatAberto() && v.autor_id !== estado.meuJogadorId) {
      tocarSom('clique');
      mostrarPreviewVotacao(v);
    }
  } else if (!v) {
    chat.votacaoVistaId = null;
  }

  const abas = $id('chat-abas');
  if (abas) abas.hidden = false;
  const btnVoto = $id('aba-btn-votacao');
  if (btnVoto) btnVoto.hidden = !modoOnlineAtivo();

  if (!modoOnlineAtivo()) {
    const card = $id('votacao-ativa-card');
    if (card) { card.hidden = true; card.innerHTML = ''; }
    if (chat.abaAtual === 'votacao') {
      escolherAbaChat('chat');
    }
  } else {
    desenharCardVotacaoAtiva();
    if (chatAberto() && chat.abaAtual === 'votacao') {
      desenharPainelVotacao();
    }
  }

  atualizarBadge();
}

export function atualizarContagemVotacao() {
  const p = estado.partidaAtual;
  if (!p || !p.votacao) return;
  const restante = segundosRestantesVotacao(p.votacao);
  document.querySelectorAll('[data-contagem-votacao]').forEach((el) => {
    el.textContent = restante + 's';
  });
  if (restante <= 0) {
    atualizarVotacaoUI();
  }
}

export async function iniciarVotacao(tipo, alvoId) {
  if (!estado.partidaAtual || !estado.meuJogadorId || !estado.meuSegredo) return;
  tocarSom('clique');
  limparErro('erro-votacao');
  const ok = await executar('iniciar_votacao_online', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo,
    p_tipo: tipo,
    p_alvo: alvoId || null
  }, 'erro-votacao');
  if (ok) atualizarVotacaoUI();
}

export async function enviarVoto(voto) {
  if (!estado.partidaAtual || !estado.meuJogadorId || !estado.meuSegredo) return;
  tocarSom('clique');
  limparErro('erro-votacao');
  const ok = await executar('votar_sala_online', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo,
    p_voto: Boolean(voto)
  }, 'erro-votacao');
  if (ok) atualizarVotacaoUI();
}

function tocarSomChatSuave() {
  const agora = Date.now();
  if (agora - chat.ultimoSomEm < COOLDOWN_SOM_CHAT_MS) return;
  chat.ultimoSomEm = agora;
  tocarSom('chat-msg');
}

function podeMostrarPreviewAutor(chave) {
  if (!chave) return true;
  const agora = Date.now();
  const ant = chat.ultimoPreviewPor.get(chave) || 0;
  if (agora - ant < COOLDOWN_PREVIEW_AUTOR_MS) return false;
  chat.ultimoPreviewPor.set(chave, agora);
  if (chat.ultimoPreviewPor.size > 32) {
    for (const [k, ts] of chat.ultimoPreviewPor.entries()) {
      if (agora - ts > COOLDOWN_PREVIEW_AUTOR_MS * 2) chat.ultimoPreviewPor.delete(k);
    }
  }
  return true;
}

function definirControlesChatDesabilitados(desabilitado) {
  const btn = $id('btn-enviar-chat');
  if (btn) btn.disabled = Boolean(desabilitado);
  document.querySelectorAll('#chat-atalhos .chat-chip').forEach((chip) => {
    chip.disabled = Boolean(desabilitado);
  });
}

function aplicarCooldownEnvio(ms) {
  clearTimeout(chat.timerCooldown);
  if (!(ms > 0)) {
    definirControlesChatDesabilitados(false);
    return;
  }
  definirControlesChatDesabilitados(true);
  chat.timerCooldown = setTimeout(() => {
    chat.timerCooldown = null;
    if (!chat.enviando) definirControlesChatDesabilitados(false);
  }, ms);
}

export function limparChatMesa() {
  chat.partidaId = null;
  chat.mensagens = [];
  chat.ids.clear();
  chat.naoLidas = 0;
  chat.enviando = false;
  chat.sujo = false;
  chat.ultimoEnvioEm = 0;
  chat.enviosRecentes = [];
  clearTimeout(chat.timerCooldown);
  chat.timerCooldown = null;
  definirControlesChatDesabilitados(false);
  chat.ultimoSomEm = 0;
  chat.ultimoPreviewPor.clear();
  chat.abaAtual = 'chat';
  chat.digitandoPor.clear();
  clearTimeout(chat.timerDigitando);
  chat.timerDigitando = null;
  chat.votacaoVistaId = null;
  atualizarBadge();
  atualizarDigitandoUI();
  limparPreviewChat();
  limparFlutuantesPerfil();
  limparErro('erro-votacao');
  const pop = $id('popover-reacoes');
  if (pop) pop.hidden = true;
  document.querySelectorAll('.reacao-balao').forEach((el) => el.remove());
  const lista = $id('chat-lista');
  if (lista) lista.innerHTML = '';
  const campo = $id('campo-chat');
  if (campo) campo.value = '';
  const card = $id('votacao-ativa-card');
  if (card) { card.hidden = true; card.innerHTML = ''; }
  const pVoto = $id('painel-votacao');
  if (pVoto) pVoto.innerHTML = '';
}

export async function iniciarChatMesa(partidaId) {
  limparChatMesa();
  if (!partidaId) return;
  chat.partidaId = partidaId;
  desenharChat();
  atualizarVotacaoUI();

  try {
    const resp = await banco.rpc('listar_mensagens_chat', {
      p_partida: partidaId,
      p_limite: 60
    });
    if (resp.error || chat.partidaId !== partidaId) return;
    const lista = Array.isArray(resp.data) ? resp.data : [];
    for (const m of lista) {
      if (m && m.id != null && !chat.ids.has(m.id)) {
        chat.ids.add(m.id);
        chat.mensagens.push(m);
      }
    }
    desenharChat();
  } catch (erro) {}
}

export function receberMensagemChat(msg) {
  if (!msg || msg.id == null || !chat.partidaId) return;
  if (chat.ids.has(msg.id)) return;
  const textoSeguro = String(msg.texto || '').slice(0, 240);
  const msgSegura = textoSeguro === msg.texto ? msg : { ...msg, texto: textoSeguro };
  chat.ids.add(msgSegura.id);
  const estourou = chat.mensagens.length >= 100;
  chat.mensagens.push(msgSegura);
  if (chat.mensagens.length > 100) {
    const removida = chat.mensagens.shift();
    if (removida) chat.ids.delete(removida.id);
  }

  if (msgSegura.autor_id) {
    chat.digitandoPor.delete(String(msgSegura.autor_id));
    atualizarDigitandoUI();
  }

  const vendoChat = chatAberto() && chat.abaAtual === 'chat';
  if (!vendoChat) {
    chat.sujo = true;
    if (!ehMinhaMensagem(msgSegura)) {
      chat.naoLidas += 1;
      atualizarBadge();
      tocarSomChatSuave();
    }
    const chaveAutor = String(msgSegura.autor_id || msgSegura.autor_nome || '');
    if (!chatAberto() && podeMostrarPreviewAutor(chaveAutor)) {
      mostrarPreviewChat(msgSegura);
    }
  } else {
    const lista = $id('chat-lista');
    if (lista) {
      if (chat.mensagens.length === 1 || lista.querySelector('.chat-vazio')) {
        desenharChat();
      } else {
        if (estourou && lista.firstElementChild) lista.firstElementChild.remove();
        lista.insertAdjacentHTML('beforeend', htmlMensagemChat(msgSegura));
        rolarFim();
      }
    }
  }
}

export function abrirChat(abaInicial) {
  if (!estado.partidaAtual) return;
  limparPreviewChat();
  limparErro('erro-votacao');
  const online = modoOnlineAtivo();
  const alvoAba = abaInicial === 'log'
    ? 'log'
    : ((online && (abaInicial === 'votacao' || (!abaInicial && votacaoAguardandoMeuVoto())))
        ? 'votacao'
        : 'chat');

  abrirFolha('folha-chat');
  escolherAbaChat(alvoAba);
  desenharChat();
  atualizarVotacaoUI();

  if (alvoAba === 'chat') {
    requestAnimationFrame(() => {
      rolarFim();
      if (window.matchMedia && window.matchMedia('(min-width: 820px)').matches) {
        const campo = $id('campo-chat');
        if (campo) campo.focus();
      }
    });
  }
}

async function enviarTextoChat(texto) {
  if (chat.enviando || !estado.partidaAtual) return false;
  const limpo = String(texto || '').trim().slice(0, 240);
  if (!limpo) return false;

  const agora = Date.now();
  const faltaCooldown = COOLDOWN_CHAT_MS - (agora - chat.ultimoEnvioEm);
  if (faltaCooldown > 0) {
    aplicarCooldownEnvio(faltaCooldown);
    aviso('Calma! Aguarde um instante antes de enviar outra mensagem.');
    return false;
  }

  chat.enviosRecentes = chat.enviosRecentes.filter((ts) => agora - ts < JANELA_RAJADA_CHAT_MS);
  if (chat.enviosRecentes.length >= MAX_RAJADA_CHAT) {
    const faltaRajada = Math.max(COOLDOWN_CHAT_MS, JANELA_RAJADA_CHAT_MS - (agora - chat.enviosRecentes[0]));
    aplicarCooldownEnvio(Math.min(faltaRajada, 3000));
    aviso('Muitas mensagens seguidas. Aguarde alguns segundos.');
    return false;
  }

  chat.enviando = true;
  definirControlesChatDesabilitados(true);

  let resp;
  try {
    resp = await banco.rpc('enviar_mensagem_chat', {
      p_partida: estado.partidaAtual.id,
      p_conta: estado.minhaConta ? estado.minhaConta.id : null,
      p_token: estado.minhaConta ? estado.minhaConta.token : null,
      p_texto: limpo,
      p_jogador: estado.meuJogadorId || null,
      p_segredo: estado.meuSegredo || null
    });
  } catch (erro) {
    resp = { error: { message: 'Sem conexão para enviar mensagem.' } };
  }

  chat.enviando = false;

  if (resp.error) {
    definirControlesChatDesabilitados(false);
    aviso(resp.error.message || 'Não foi possível enviar a mensagem.');
    return false;
  }

  const enviadoEm = Date.now();
  chat.ultimoEnvioEm = enviadoEm;
  chat.enviosRecentes.push(enviadoEm);
  aplicarCooldownEnvio(COOLDOWN_CHAT_MS);

  publicarDigitando({
    partida_id: estado.partidaAtual.id,
    jogador_key: meuAutorKey(),
    autor_nome: meuNomeAutor(),
    ativo: false
  });

  if (resp.data) {
    receberMensagemChat(resp.data);
    publicarChat(resp.data);
  }
  return true;
}

export async function enviarChat() {
  const campo = $id('campo-chat');
  if (!campo) return;
  const ok = await enviarTextoChat(campo.value);
  if (ok) campo.value = '';
}

export function enviarAtalhoChat(texto) {
  return enviarTextoChat(texto);
}

// ----- Reações rápidas sobre os avatares -----
export function alternarReacoes(forcarFechar, ancoraEl) {
  const pop = $id('popover-reacoes');
  if (!pop) return;
  const fechar = forcarFechar === true || !pop.hidden;
  pop.hidden = fechar;
  document.querySelectorAll('.meu-avatar-reacoes').forEach((el) => {
    el.setAttribute('aria-expanded', fechar ? 'false' : 'true');
  });
  if (fechar) return;

  const alvo = (ancoraEl && ancoraEl.getBoundingClientRect)
    ? ancoraEl
    : (document.querySelector('#meu-perfil-dock:not([hidden]) .meu-avatar-reacoes')
      || document.querySelector('#lista-jogadores .lugar.eu .meu-avatar-reacoes'));

  if (alvo) {
    const rect = alvo.getBoundingClientRect();
    const popW = pop.offsetWidth || 286;
    const popH = pop.offsetHeight || 110;
    let top = rect.top - popH - 10;
    if (top < 10) top = Math.min(window.innerHeight - popH - 10, rect.bottom + 10);
    const left = Math.max(10, Math.min(window.innerWidth - popW - 10, rect.left));
    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(left) + 'px';
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
  } else {
    pop.style.top = '';
    pop.style.left = '';
    pop.style.right = '';
    pop.style.bottom = '';
  }
}

export function receberReacao(payload) {
  if (!payload || !payload.texto) return;
  if (payload.partida_id && estado.partidaAtual && payload.partida_id !== estado.partidaAtual.id) return;

  const jid = payload.jogador_id;
  const chaveAutor = String(jid || payload.autor_nome || '');
  if (jid === estado.meuJogadorId || podeMostrarPreviewAutor(chaveAutor)) {
    mostrarPreviewReacao(payload);
  }

  if (!jid || jid !== estado.meuJogadorId) tocarSom('reacao');
}

export function enviarReacao(texto) {
  if (!estado.partidaAtual || !texto) return;
  const agora = Date.now();
  if (agora - chat.ultimaReacaoEm < 1400) return;
  chat.ultimaReacaoEm = agora;

  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  const payload = {
    partida_id: estado.partidaAtual.id,
    jogador_id: estado.meuJogadorId || null,
    autor_nome: eu ? eu.nome : (estado.minhaConta ? estado.minhaConta.nome : 'Jogador'),
    texto: String(texto).slice(0, 24),
    ts: agora
  };
  alternarReacoes(true);
  receberReacao(payload);
  publicarReacao(payload);
}
