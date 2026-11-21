// Ciclo de vida e renderização compartilhada da mesa (elipse 360°, pote, potes laterais, cronômetros)
// Delega detalhes específicos de cada modo ('presencial' / futuro 'online') via modos.js
import { banco } from '../core/supabase.js?v=61';
import { estado, ICONE_COROA, nomeDe, contaParams, marcarReal, valorPorMil, limparCachesMesa } from '../core/estado.js?v=61';
import { lerMeuJogador, guardarPartidaAtual, esquecerPartida, esquecerSegredo, lerDevSala, salvarDevSala } from '../core/storage.js?v=61';
import { $id, escapar, aviso, mostrar, mostrarErro, limparErro, abrirFolha, fecharFolhas } from '../core/ui.js?v=61';
import { nomePoteCurto, potesVisiveisNaMesa } from '../core/potes.js?v=61';
import { ligarTempoReal, desligarTempoReal, publicarBroadcast, canalAtivo } from '../core/realtime.js?v=61';
import { obterModo } from './modos.js?v=61';
import { desenharHistorico, carregarValorReal, atualizarReais, desenharDetalhesPotes } from './extras.js?v=61';
import { executar, desenharBarraAcoes, registrarHooksApostas } from './apostas.js?v=61';
import { obterAvatarUrl, sincronizarAvataresMesa } from '../lobby/perfil.js?v=61';
import { tocarSom, foiAcaoLocalRecente } from '../core/som.js?v=61';
import { iniciarChatMesa, limparChatMesa, receberMensagemChat } from './chat.js?v=61';

const NOMES_FASE = ['Pré-flop', 'Flop', 'Turn', 'River', 'Showdown'];

// Rastreia transições da mesa para disparar sons sem repetir em polling ou na entrada da sala
const somMesa = {
  partidaId: null,
  iniciada: false,
  mao: null,
  ultimoHist: null
};

let hooksApp = {
  abrirSalas: () => {},
  controlarDev: () => {},
  desenharPainelDev: () => {},
  apagarSalaDev: () => {},
  autoSeguirVezDev: () => {}
};

export function registrarHooksMesa(hooks) {
  hooksApp = Object.assign(hooksApp, hooks);
}

// Conecta apostas.js às funções de sincronização da mesa
registrarHooksApostas({
  publicarEstado,
  buscarMesa,
  restaurarTela
});

export async function abrirMesa(partida, estadoInicial) {
  estado.partidaAtual = partida;
  estado.modoAtual = (partida && partida.modo) ? partida.modo : 'presencial';

  if (!estado.modoDev) {
    const contaId = estado.minhaConta ? estado.minhaConta.id : null;
    const guardado = lerMeuJogador(contaId, partida.id);
    estado.meuJogadorId = guardado ? guardado.id : null;
    estado.meuSegredo = guardado ? guardado.segredo : null;
    guardarPartidaAtual(partida.id);
  }

  limparCachesMesa();
  limparErro('erro-barra');
  limparErro('erro-criador');
  const modo = obterModo(estado.modoAtual);
  if (modo && modo.aoSairDaMesa) modo.aoSairDaMesa();

  $id('campo-valor').value = '';
  estado.apostaEditada = false;
  estado.apostaAberta = false;
  estado.ultimoEstado = null;
  estado.maoVista = null;
  estado.blindsVistos = null;
  estado.bigMesaEditado = false;

  if (estadoInicial) receberEstado(estadoInicial, true);
  else await buscarMesa(true);
  if (!estado.partidaAtual) return;

  mostrar('tela-mesa');
  iniciarChatMesa(partida.id);
  ligarTempoReal({
    onEstado: receberEstado,
    onBuscar: buscarMesa,
    onConectado: carregarValorReal,
    onChat: receberMensagemChat
  });
}

export function buscarMesa(forcar) {
  if (!estado.partidaAtual) return Promise.resolve();
  if (estado.promessaBusca) { estado.buscaSuja = true; return estado.promessaBusca; }

  estado.promessaBusca = (async () => {
    try {
      do {
        estado.buscaSuja = false;
        const id = estado.partidaAtual && estado.partidaAtual.id;
        if (!id) break;

        let resp;
        try {
          resp = await banco.rpc('estado_mesa', { p_partida: id });
        } catch (erro) {
          break;
        }
        if (resp.error) break;
        if (!estado.partidaAtual || estado.partidaAtual.id !== id) break;

        receberEstado(resp.data, forcar);
      } while (estado.buscaSuja);
    } finally {
      estado.promessaBusca = null;
    }
  })();
  return estado.promessaBusca;
}

export function receberEstado(novoEstado, forcar) {
  if (!estado.partidaAtual) return;
  if (!novoEstado || !novoEstado.partida) {
    aviso('Essa sala não existe mais.');
    voltarParaSalas();
    return;
  }
  if (novoEstado.partida.id !== estado.partidaAtual.id) return;

  const versao = Number(novoEstado.partida.versao) || 0;
  if (!forcar && versao <= estado.ultimaVersao) return;
  estado.ultimaVersao = versao;
  desenharMesa(novoEstado);
}

export function publicarEstado(novoEstado) {
  publicarBroadcast(novoEstado);
  receberEstado(novoEstado, false);
}

export function restaurarTela() {
  if (estado.ultimoEstado && estado.partidaAtual) desenharMesa(estado.ultimoEstado);
  buscarMesa(true);
}

export function desenharMesa(dados) {
  const partida = dados.partida;
  const jogadores = dados.jogadores;

  if (partida.encerrada) {
    aviso('Essa sala foi encerrada.');
    voltarParaSalas();
    return;
  }

  estado.partidaAtual = partida;
  estado.modoAtual = partida.modo || 'presencial';
  const ehModoOnline = estado.modoAtual === 'online';
  document.body.classList.toggle('modo-online', ehModoOnline);
  $id('tela-mesa').classList.toggle('modo-online', ehModoOnline);
  $id('barra-acoes').classList.toggle('modo-online', ehModoOnline);
  if (Number(partida.valor_real_mil) > 0) marcarReal(partida.id, Number(partida.valor_real_mil));
  estado.jogadoresAtuais = jogadores;
  estado.ultimoEstado = dados;

  const eu = jogadores.find((j) => j.id === estado.meuJogadorId) || null;

  if (estado.meuJogadorId && !eu && estado.modoDev) {
    const salaDev = lerDevSala();
    if (salaDev) {
      salaDev.jogadores = salaDev.jogadores.filter((x, k) => k === 0 || jogadores.some((j) => j.id === x.id));
      salvarDevSala(salaDev);
      estado.htmlDevVisto = '';
      hooksApp.controlarDev(0, salaDev);
      buscarMesa(true);
      return;
    }
  }
  if (estado.meuJogadorId && !eu) {
    esquecerSegredo(estado.minhaConta ? estado.minhaConta.id : null, partida.id);
    aviso('Você não está mais nesta sala.');
    voltarParaSalas();
    return;
  }

  const modo = obterModo(estado.modoAtual);
  // O modo pode conduzir uma "cena" (ex.: Online revela flop/turn/river/showdown em câmera lenta)
  if (modo && modo.prepararCena) modo.prepararCena(partida, jogadores);
  const congelado = (modo && modo.visaoCongelada) ? modo.visaoCongelada() : null;
  const jogadoresVis = (congelado && congelado.jogadores) || jogadores;
  const poteVis = (congelado && congelado.pote !== null && congelado.pote !== undefined) ? congelado.pote : partida.pote;

  const jogadorDaVez = jogadores.find((j) => j.id === partida.vez_jogador_id) || null;
  const emJogo = partida.iniciada && !partida.aguardando_cartas && !partida.aguardando_proxima_mao && partida.fase < 4;
  const vezAtivaId = emJogo ? partida.vez_jogador_id : null;
  const minhaVez = !!eu && emJogo && partida.vez_jogador_id === eu.id;
  const falta = eu ? Math.max(0, partida.aposta_atual - eu.apostou) : 0;

  if (minhaVez && !estado.eraMinhaVez && navigator.vibrate) {
    try { navigator.vibrate([150, 80, 150]); } catch (erro) {}
  }
  if (minhaVez && !estado.eraMinhaVez && !ehModoOnline) {
    tocarSom('sua-vez');
  }
  if (minhaVez && !estado.eraMinhaVez) { estado.apostaEditada = false; estado.apostaAberta = false; }
  estado.eraMinhaVez = minhaVez;

  // Sons sincronizados de nova mão e jogadas de outros jogadores em tempo real
  const primeiroHist = (dados.historico && dados.historico[0])
    ? (dados.historico[0].mao + ':' + dados.historico[0].texto)
    : null;
  if (somMesa.partidaId !== partida.id) {
    somMesa.partidaId = partida.id;
    somMesa.iniciada = !!partida.iniciada;
    somMesa.mao = partida.mao;
    somMesa.ultimoHist = primeiroHist;
  } else {
    const novaMaoComecou = (!somMesa.iniciada && partida.iniciada)
      || (partida.iniciada && !partida.aguardando_proxima_mao && somMesa.mao !== null && partida.mao > somMesa.mao);
    if (novaMaoComecou) {
      tocarSom('embaralhar');
      if (modo && modo.aoNovaMao) modo.aoNovaMao();
    } else if (!congelado && primeiroHist && primeiroHist !== somMesa.ultimoHist && !foiAcaoLocalRecente()) {
      const txt = dados.historico[0].texto || '';
      if (/all-in/i.test(txt)) tocarSom('allin');
      else if (/desistiu/i.test(txt)) tocarSom('desistir');
      else if (/\bcheck\b|passou/i.test(txt)) tocarSom('check');
      else if (/pagou|apostou|aumentou/i.test(txt)) tocarSom('ficha');
    }
    somMesa.iniciada = !!partida.iniciada;
    if (!partida.aguardando_proxima_mao) somMesa.mao = partida.mao;
    if (!congelado) somMesa.ultimoHist = primeiroHist;
  }

  // ----- Topo e ficha do pote -----
  $id('mesa-sala').textContent = nomeDe(partida.nome || ('Sala ' + partida.codigo));

  const elPote = $id('mesa-pote');
  elPote.textContent = poteVis;
  elPote.dataset.len = String(String(poteVis).length);
  if (estado.ultimoPote !== null && estado.ultimoPote !== poteVis) {
    const ficha = $id('pote-ficha');
    ficha.classList.remove('bump');
    void ficha.offsetWidth;
    ficha.classList.add('bump');
  }
  estado.ultimoPote = poteVis;

  if (estado.maoVista !== null && partida.mao > estado.maoVista && !ehModoOnline) {
    aviso('Mão ' + (partida.mao - 1) + ' terminou. Veja o histórico.');
  }
  estado.maoVista = partida.mao;

  const maoVis = partida.aguardando_proxima_mao ? Math.max(1, partida.mao - 1) : partida.mao;
  $id('mesa-mao').textContent = partida.iniciada ? 'Mão ' + maoVis : '';
  $id('mesa-nivel').textContent = 'Nível ' + partida.nivel;
  $id('mesa-blinds').textContent = 'Blinds ' + partida.small_blind + '/' + partida.big_blind;
  $id('mesa-aposta').textContent = (partida.iniciada && !partida.aguardando_proxima_mao && partida.fase < 4)
    ? 'Maior aposta ' + partida.aposta_atual
    : '';
  $id('mesa-papel').textContent = estado.modoDev
    ? 'DEV · ' + (eu ? nomeDe(eu.nome) : 'só assistindo')
    : (eu ? 'Você é o Jogador ' + eu.ordem : 'Você está só assistindo');

  $id('tela-mesa').classList.toggle(
    'em-showdown',
    ehModoOnline && !!partida.aguardando_proxima_mao && !congelado && !!partida.ultimo_resultado
  );
  atualizarResumoTopoOnline();

  // ----- Potes laterais na mesa -----
  const potesMesa = congelado ? null : potesVisiveisNaMesa(partida, jogadores);
  const elMesaPotes = $id('mesa-potes');
  if (potesMesa && potesMesa.length >= 2) {
    const htmlPotes = potesMesa.map((p, i) => (
      '<span class="pote-mini">' + nomePoteCurto(i, potesMesa.length) + ' <b>' + p.valor + '</b></span>'
    )).join('<span class="pote-sep">·</span>');
    if (htmlPotes !== estado.htmlPotesVisto) {
      estado.htmlPotesVisto = htmlPotes;
      elMesaPotes.innerHTML = htmlPotes;
    }
    elMesaPotes.hidden = false;
  } else {
    elMesaPotes.hidden = true;
    if (estado.htmlPotesVisto) { estado.htmlPotesVisto = ''; elMesaPotes.innerHTML = ''; }
  }
  if (!$id('folha-potes').hidden) {
    if (potesMesa && potesMesa.length >= 2) desenharDetalhesPotes();
    else fecharFolhas();
  }

  // ----- Faixa de status -----
  const statusModo = (modo && modo.textoStatus) ? modo.textoStatus(partida) : null;
  const status = statusModo || calcularTextoStatus({ partida, jogadores, eu, jogadorDaVez, minhaVez });
  const elStatus = $id('mesa-status');
  elStatus.textContent = status;
  elStatus.classList.toggle('minha-vez', minhaVez);

  // ----- Board (delegado ao modo: presencial = slots, online = cartas viradas) -----
  const faseVis = (modo && modo.faseExibida) ? modo.faseExibida(partida) : partida.fase;
  $id('mesa-fase').textContent = partida.iniciada ? NOMES_FASE[faseVis] : '';
  if (modo && modo.desenharBoard) modo.desenharBoard(partida, jogadores);

  // ----- Assentos em elipse 360° -----
  desenharAssentos({ partida, jogadores: jogadoresVis, vezAtivaId, modo, congelado: !!congelado });
  sincronizarAvataresMesa(jogadores, () => {
    if (estado.ultimoEstado) {
      estado.htmlJogadoresVisto = '';
      desenharMesa(estado.ultimoEstado);
    }
  });

  // ----- Cronômetros e histórico -----
  estado.relogio.offset = dados.agora ? Date.parse(dados.agora) - Date.now() : 0;
  estado.relogio.ini = partida.iniciada && partida.iniciada_em ? Date.parse(partida.iniciada_em) : null;
  estado.relogio.vez = vezAtivaId && partida.vez_desde ? Date.parse(partida.vez_desde) : null;
  tick();
  if (congelado) {
    const ult = $id('mesa-ultima');
    if (ult) ult.textContent = 'All-in! Acompanhando as cartas…';
  } else {
    desenharHistorico(dados.historico);
  }

  // ----- Faixa de fase e painel do criador (delegados ao modo) -----
  const souCriador = (!!eu && eu.criador) || estado.modoDev;
  const ctxModo = { eu, souCriador, potesMesa, nomesFase: NOMES_FASE };
  if (modo && modo.desenharFaixa) modo.desenharFaixa(partida, jogadores, ctxModo);
  if (modo && modo.desenharCriador) modo.desenharCriador(partida, jogadores, ctxModo);

  // ----- Botões globais do topo (DEV / Reais) -----
  $id('btn-dev').hidden = !estado.modoDev;
  const btnProx = $id('btn-dev-prox');
  btnProx.hidden = !estado.modoDev;
  if (estado.modoDev) {
    const rotuloProx = (jogadorDaVez && (!eu || jogadorDaVez.id !== eu.id))
      ? 'Ir para ' + nomeDe(jogadorDaVez.nome) + ' ▶'
      : 'Próximo (' + (eu ? nomeDe(eu.nome) : 'DEV') + ') ▶';
    btnProx.textContent = rotuloProx;
  }
  atualizarReais(false);
  if (estado.modoDev) hooksApp.desenharPainelDev();

  // ----- Barra de ações -----
  desenharBarraAcoes({ partida, jogadores, eu, minhaVez, emJogo, falta, status });
  if (modo && modo.aoAtualizarMesa) modo.aoAtualizarMesa(partida, jogadores, ctxModo);
}

function calcularTextoStatus({ partida, jogadores, eu, jogadorDaVez, minhaVez }) {
  if (partida.modo === 'online') {
    const comFichas = jogadores.filter((j) => j.saldo > 0).length;
    if (!partida.iniciada) return 'Aguardando jogadores confirmarem entrada';
    if (partida.aguardando_proxima_mao) {
      if (comFichas < 2) return 'Fim da partida!';
      return 'Mão ' + (partida.mao - 1) + ' terminou · confirme para a próxima mão';
    }
    if (jogadorDaVez && partida.fase_blind === 1) {
      return minhaVez ? 'Você deve pagar o small blind' : nomeDe(jogadorDaVez.nome) + ' deve pagar o small blind';
    }
    if (jogadorDaVez && partida.fase_blind === 2) {
      return minhaVez ? 'Você deve pagar o big blind' : nomeDe(jogadorDaVez.nome) + ' deve pagar o big blind';
    }
    if (jogadorDaVez) return minhaVez ? 'Sua vez de jogar!' : 'Vez de ' + nomeDe(jogadorDaVez.nome);
    return 'Atualizando mesa…';
  }
  if (!partida.iniciada) return 'Aguardando o criador iniciar a partida';
  if (partida.aguardando_proxima_mao) {
    const comFichas = jogadores.filter((j) => j.saldo > 0).length;
    if (comFichas < 2) return 'Fim da partida: só resta um jogador com fichas.';
    if (eu && eu.criador) return 'Mão ' + (partida.mao - 1) + ' terminou. Toque em "Próxima mão" quando quiser.';
    return 'Mão ' + (partida.mao - 1) + ' terminou. Aguardando o criador.';
  }
  if (jogadorDaVez && partida.fase_blind === 1) {
    return minhaVez ? 'Você deve pagar o small blind' : nomeDe(jogadorDaVez.nome) + ' deve pagar o small blind';
  }
  if (jogadorDaVez && partida.fase_blind === 2) {
    return minhaVez ? 'Você deve pagar o big blind' : nomeDe(jogadorDaVez.nome) + ' deve pagar o big blind';
  }
  if (partida.fase === 4) return 'Showdown: mostrem as cartas. O criador distribui o pote.';
  if (partida.aguardando_cartas) return 'Virem as cartas do ' + NOMES_FASE[partida.fase] + '.';
  if (jogadorDaVez) return minhaVez ? 'Sua vez de jogar!' : 'Vez de ' + nomeDe(jogadorDaVez.nome);
  if (partida.pote > 0) return 'Aguardando o criador distribuir o pote.';
  return 'Fim da partida: só resta um jogador com fichas.';
}

// Coordenadas (x%, y%) dos assentos quando TODOS ficam na elipse (Presencial / espectador)
const POSICOES_MOBILE_ONLINE = {
  2: [[50, 91], [50, 9]],
  3: [[50, 91], [14, 24], [86, 24]],
  4: [[50, 91], [14, 26], [50, 9], [86, 26]],
  5: [[50, 91], [14, 72], [15, 23], [85, 23], [86, 72]],
  6: [[50, 91], [14, 72], [14, 26], [50, 9], [86, 26], [86, 72]],
  7: [[50, 91], [14, 73], [13, 30], [33, 9], [67, 9], [87, 30], [86, 73]],
  8: [[50, 91], [13, 74], [11, 50], [14, 25], [50, 9], [86, 25], [89, 50], [87, 74]],
  9: [[50, 91], [13, 75], [11, 51], [13, 26], [34, 9], [66, 9], [87, 26], [89, 51], [87, 75]]
};

const POSICOES_DESKTOP_ONLINE = {
  2: [[50, 91], [50, 9]],
  3: [[50, 91], [10, 26], [90, 26]],
  4: [[50, 91], [9, 50], [50, 9], [91, 50]],
  5: [[50, 91], [11, 72], [13, 22], [87, 22], [89, 72]],
  6: [[50, 91], [11, 74], [11, 26], [50, 9], [89, 26], [89, 74]],
  7: [[50, 91], [12, 76], [9, 36], [31, 9], [69, 9], [91, 36], [88, 76]],
  8: [[50, 91], [14, 80], [9, 50], [14, 20], [50, 9], [86, 20], [91, 50], [86, 80]],
  9: [[50, 91], [15, 81], [9, 52], [13, 22], [34, 9], [66, 9], [87, 22], [91, 52], [85, 81]]
};

// Coordenadas (x%, y%) dos adversários (1..8) distribuídos em volta da borda da mesa vertical (você na ponta de baixo!)
const POSICOES_OPONENTES_MOBILE = {
  1: [[50, 9]],
  2: [[16, 26], [84, 26]],
  3: [[15, 34], [50, 9], [85, 34]],
  4: [[15, 83], [15, 25], [85, 25], [85, 83]],
  5: [[15, 83], [15, 29], [50, 9], [85, 29], [85, 83]],
  6: [[15, 84], [14, 42], [25, 10], [75, 10], [86, 42], [85, 84]],
  7: [[15, 85], [13, 52], [17, 23], [50, 9], [83, 23], [87, 52], [85, 85]],
  8: [[15, 85], [13, 54], [16, 26], [34, 9], [66, 9], [84, 26], [87, 54], [85, 85]]
};

const POSICOES_OPONENTES_DESKTOP = {
  1: [[50, 11]],
  2: [[14, 28], [86, 28]],
  3: [[11, 52], [50, 11], [89, 52]],
  4: [[13, 72], [14, 24], [86, 24], [87, 72]],
  5: [[12, 74], [12, 28], [50, 11], [88, 28], [88, 74]],
  6: [[13, 76], [10, 38], [32, 11], [68, 11], [90, 38], [87, 76]],
  7: [[14, 78], [10, 48], [15, 20], [50, 10], [85, 20], [90, 48], [86, 78]],
  8: [[14, 79], [10, 50], [14, 22], [35, 10], [65, 10], [86, 22], [90, 50], [86, 79]]
};

function montarTagsAssento({ j, partida, naVez, emEsperaOnline, premioVencedor, ehOnline }) {
  let tags = '';
  if (premioVencedor > 0) {
    tags += '<span class="tag ganhou">🏆 +' + premioVencedor + '</span>';
  }
  if (emEsperaOnline) {
    if (j.saldo === 0) tags += '<span class="tag fora">ELIMINADO</span>';
    else if (j.confirmado) tags += '<span class="tag pronto">✓ PRONTO</span>';
    if (j.id === partida.dealer_jogador_id) tags += '<span class="tag d" title="Dealer">D</span>';
  } else if (partida.iniciada) {
    if (j.esperando) tags += '<span class="tag espera">ESPERANDO</span>';
    else if (j.desistiu) tags += '<span class="tag fora">DESISTIU</span>';
    else if (j.saldo === 0 && j.total_mao === 0) tags += '<span class="tag fora">' + (ehOnline ? 'ELIMINADO' : 'SEM FICHAS') + '</span>';
    else {
      if (naVez && partida.fase_blind === 1) tags += '<span class="tag vez">PAGAR SB</span>';
      else if (naVez && partida.fase_blind === 2) tags += '<span class="tag vez">PAGAR BB</span>';
      if (j.saldo === 0) tags += '<span class="tag allin">ALL-IN</span>';
    }
    if (j.id === partida.dealer_jogador_id) tags += '<span class="tag d" title="Dealer">D</span>';
  }
  return tags;
}

function classePosicaoBorda(j, partida) {
  if (!partida || !partida.iniciada || !j) return 'pos-none';
  if (j.id === partida.dealer_jogador_id) return 'pos-d';
  if (j.id === partida.bb_jogador_id) return 'pos-bb';
  if (j.id === partida.sb_jogador_id) return 'pos-sb';
  return 'pos-none';
}

function desenharMeuPerfilDock({ partida, eu, vezAtivaId, proximoId, emEsperaOnline, modo }) {
  const dock = $id('meu-perfil-dock');
  if (!dock) return;
  if (!eu || partida.modo !== 'online') {
    dock.hidden = true;
    dock.innerHTML = '';
    return;
  }

  const naVez = !!vezAtivaId && eu.id === vezAtivaId;
  const ehProximo = !naVez && !eu.desistiu && eu.id === proximoId;
  const ehVencedor = !!(modo && modo.ehVencedorAssento && modo.ehVencedorAssento(eu, partida));
  const premioVencedor = (modo && modo.premioVencedorAssento) ? modo.premioVencedorAssento(eu, partida) : 0;

  let classes = 'meu-perfil-dock';
  if (naVez) classes += ' vez';
  if (ehProximo) classes += ' prox';
  if (ehVencedor) classes += ' vencedor';
  if (eu.esperando) classes += ' espera';
  else if (eu.desistiu) classes += ' desistiu';

  const corFicha = 'c' + (((Number(eu.ordem) || 1) - 1) % 8 + 1);
  const posBorda = classePosicaoBorda(eu, partida);
  const avatarUrl = obterAvatarUrl(eu.conta_id);
  const badgePerfilHtml = avatarUrl
    ? '<div class="l-avatar ' + corFicha + ' ' + posBorda + '"><img src="' + avatarUrl + '" alt=""></div>'
    : '<div class="ficha ' + corFicha + ' ' + posBorda + '">' + eu.ordem + '</div>';

  const tags = montarTagsAssento({
    j: eu,
    partida,
    naVez,
    ehProximo,
    emEsperaOnline,
    premioVencedor,
    ehOnline: true
  });

  dock.className = classes;
  dock.dataset.jogadorId = eu.id;
  const dicaAtual = $id('mp-dica') ? $id('mp-dica').innerHTML : '';
  const dicaOculta = $id('mp-dica') ? $id('mp-dica').hidden : true;
  dock.innerHTML = `
    <div class="mp-esq">
      ${badgePerfilHtml}
      <span class="mp-nome">${escapar(nomeDe(eu.nome))}</span>
      ${tags ? '<div class="l-tags mp-tags">' + tags + '</div>' : ''}
    </div>
    <div id="mp-dica" class="mp-dica"${dicaOculta ? ' hidden' : ''}>${dicaAtual}</div>
    <div class="mp-dir">
      <span class="mp-saldo">${Number(eu.saldo).toLocaleString('pt-BR')}</span>
      ${eu.apostou > 0 ? '<span class="l-aposta">+' + eu.apostou + '</span>' : ''}
    </div>
  `;
  dock.hidden = false;
}

function desenharAssentos({ partida, jogadores, vezAtivaId, modo, congelado }) {
  let proximoId = null;
  if (partida.iniciada && partida.fase_blind === 1) proximoId = partida.bb_jogador_id;
  else if (partida.iniciada && partida.fase_blind === 2) proximoId = partida.primeiro_jogador_id;
  else if (vezAtivaId) {
    const n = jogadores.length;
    const idx = jogadores.findIndex((j) => j.id === vezAtivaId);
    for (let k = 1; k < n; k++) {
      const c = jogadores[(idx + k) % n];
      if (!c.desistiu && c.saldo > 0 && (!c.falou || c.apostou < partida.aposta_atual)) {
        proximoId = c.id;
        break;
      }
    }
  }

  const ehOnline = partida.modo === 'online';
  const ehDesktop = window.innerWidth >= 820;
  const ehMobile = !ehDesktop;
  const emEsperaOnline = ehOnline && (!partida.iniciada || partida.aguardando_proxima_mao) && !congelado;
  const nJ = jogadores.length;
  const meuIdx = jogadores.findIndex((j) => j.id === estado.meuJogadorId);
  const eu = meuIdx >= 0 ? jogadores[meuIdx] : null;
  const heroNoDock = ehOnline && !!eu;

  // Atualiza meu perfil integrado ao dock inferior no modo Online
  desenharMeuPerfilDock({ partida, eu, vezAtivaId, proximoId, emEsperaOnline, modo });
  $id('tela-mesa').classList.toggle('hero-no-dock', heroNoDock);

  // Lista exibida ao redor da mesa (no Online com jogador sentado, apenas adversários!)
  let listaMesa = jogadores;
  if (heroNoDock) {
    listaMesa = [];
    for (let k = 1; k < nJ; k++) {
      listaMesa.push(jogadores[(meuIdx + k) % nJ]);
    }
  }

  const nMesa = listaMesa.length;
  const larguraLugar = ehDesktop
    ? (nMesa <= 4 ? 156 : nMesa <= 6 ? 148 : 138)
    : (nMesa <= 3 ? 102 : nMesa <= 5 ? 96 : nMesa <= 6 ? 90 : 84);
  const escalaLugar = ehDesktop
    ? (nMesa <= 4 ? 1.04 : nMesa <= 6 ? 0.98 : 0.92)
    : (nMesa <= 3 ? 0.96 : nMesa <= 5 ? 0.92 : nMesa <= 6 ? 0.86 : 0.82);
  const raioX = ehDesktop ? 43.5 : 40;
  const raioY = ehDesktop ? 40.5 : 39;
  const maxVw = ehDesktop ? '17vw' : (nMesa >= 7 ? '24.5vw' : nMesa >= 5 ? '27.5vw' : '29.5vw');

  const htmlLista = listaMesa.map((j, idxLista) => {
    const souEu = (j.id === estado.meuJogadorId);
    const naVez = !!vezAtivaId && j.id === vezAtivaId;
    const ehVencedor = !!(modo && modo.ehVencedorAssento && modo.ehVencedorAssento(j, partida));
    const premioVencedor = (modo && modo.premioVencedorAssento) ? modo.premioVencedorAssento(j, partida) : 0;

    let classes = 'lugar assento-redondo';
    if (souEu) classes += ' eu';
    if (naVez) classes += ' vez';
    if (ehVencedor) classes += ' vencedor';
    if (j.esperando) classes += ' espera';
    else if (j.desistiu) classes += ' desistiu';

    const tags = montarTagsAssento({ j, partida, naVez, emEsperaOnline, premioVencedor, ehOnline });

    const corFicha = 'c' + (((Number(j.ordem) || 1) - 1) % 8 + 1);
    let x;
    let y;
    if (heroNoDock) {
      const mapaOp = ehMobile ? POSICOES_OPONENTES_MOBILE[nMesa] : POSICOES_OPONENTES_DESKTOP[nMesa];
      if (mapaOp && mapaOp[idxLista]) {
        x = mapaOp[idxLista][0];
        y = mapaOp[idxLista][1];
      } else {
        const angulo = (165 + (210 * idxLista / Math.max(1, nMesa - 1))) * Math.PI / 180;
        x = 50 + raioX * Math.cos(angulo);
        y = 48 + raioY * Math.sin(angulo);
      }
    } else {
      const k = (idxLista - Math.max(0, meuIdx) + nJ) % nJ;
      const mapaPos = ehMobile ? POSICOES_MOBILE_ONLINE[nJ] : POSICOES_DESKTOP_ONLINE[nJ];
      if (mapaPos && mapaPos[k]) {
        x = mapaPos[k][0];
        y = mapaPos[k][1];
      } else {
        const angulo = (90 + (360 * k / Math.max(1, nJ))) * Math.PI / 180;
        x = 50 + raioX * Math.cos(angulo);
        y = 50 + raioY * Math.sin(angulo);
      }
    }

    const largura = larguraLugar + (souEu ? (ehDesktop ? 8 : 14) : 0);
    const maxVwAssento = (ehMobile && souEu) ? '30vw' : maxVw;
    const estiloLugar = '--x:' + x.toFixed(2) + '%;--y:' + y.toFixed(2) + '%;--w:min(' + largura + 'px,' + maxVwAssento + ');--escala-lugar:' + escalaLugar + ';';
    const cartasHtml = (modo && modo.htmlCartasAssento) ? modo.htmlCartasAssento(j, partida) : '';
    const coroaHtml = (!ehOnline && j.criador) ? ICONE_COROA : '';
    const posBorda = classePosicaoBorda(j, partida);
    const avatarUrl = obterAvatarUrl(j.conta_id);
    const badgePerfilHtml = avatarUrl
      ? '<div class="l-avatar ' + corFicha + ' ' + posBorda + '"><img src="' + avatarUrl + '" alt=""></div>'
      : '<div class="ficha ' + corFicha + ' ' + posBorda + '">' + j.ordem + '</div>';
    return `
      <div class="${classes}" data-jogador-id="${j.id}" style="${estiloLugar}">
        ${badgePerfilHtml}
        <div class="l-corpo">
          <div class="l-nome">${coroaHtml}<span class="texto">${escapar(nomeDe(j.nome))}</span>${souEu ? '<span class="l-voce">você</span>' : ''}</div>
          <div class="l-meio">
            <div class="l-saldo${String(j.saldo).length >= 5 ? ' longo' : ''}">${j.saldo}</div>
            ${j.apostou > 0 ? '<div class="l-aposta">+' + j.apostou + '</div>' : ''}
          </div>
          ${tags ? '<div class="l-tags">' + tags + '</div>' : ''}
        </div>
        ${cartasHtml}
        ${(naVez && ehOnline && Number(partida.tempo_turno) > 0) ? '<div class="l-timer"><i></i></div>' : ''}
      </div>
    `;
  }).join('');

  $id('tela-mesa').classList.toggle('muitos', nJ > 5);
  $id('tela-mesa').classList.toggle('cheia', nJ >= 7);
  $id('tela-mesa').classList.toggle('poucos-op', heroNoDock && nMesa <= 3);
  if (htmlLista !== estado.htmlJogadoresVisto) {
    estado.htmlJogadoresVisto = htmlLista;
    $id('lista-jogadores').innerHTML = htmlLista;
  }
}

// ----- Menu compacto e resumo do topo (Mobile Online) -----
function atualizarResumoTopoOnline() {
  const el = $id('topo-resumo-online');
  const p = estado.partidaAtual;
  if (!el || !p || p.modo !== 'online') return;
  const partes = [];
  if (p.iniciada) {
    const maoVis = p.aguardando_proxima_mao ? Math.max(1, p.mao - 1) : p.mao;
    partes.push('Mão ' + maoVis);
  }
  partes.push(p.small_blind + '/' + p.big_blind);
  if (estado.relogio.ini) {
    const agora = Date.now() + estado.relogio.offset;
    partes.push(formatarTempo(agora - estado.relogio.ini));
  }
  el.textContent = partes.join(' · ');
}

export function abrirMenuOnline() {
  const p = estado.partidaAtual;
  if (!p) return;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId) || null;
  $id('menu-online-titulo').textContent = nomeDe(p.nome || ('Sala ' + p.codigo));
  const info = [];
  if (estado.modoDev) info.push('Modo DEV · ' + (eu ? nomeDe(eu.nome) : 'assistindo'));
  else if (eu) info.push('Jogador ' + eu.ordem);
  if (p.iniciada) info.push('Mão ' + p.mao);
  info.push('Nível ' + p.nivel + ' · Blinds ' + p.small_blind + '/' + p.big_blind);
  $id('menu-online-info').textContent = info.join(' · ');

  $id('menu-btn-reais').hidden = !valorPorMil(p.id);
  $id('menu-btn-dev').hidden = !estado.modoDev;
  const btnSair = $id('menu-btn-sair');
  btnSair.hidden = !eu || estado.modoDev;
  const emMaoAtiva = p.iniciada && !p.aguardando_proxima_mao && eu && !eu.desistiu && eu.saldo > 0;
  btnSair.disabled = !!emMaoAtiva;

  abrirFolha('folha-menu');
}

// ----- Cronômetros -----
function formatarTempo(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sg = t % 60;
  const dois = (n) => (n < 10 ? '0' : '') + n;
  return h > 0 ? h + ':' + dois(m) + ':' + dois(sg) : dois(m) + ':' + dois(sg);
}

let hookTickOnline = null;
export function registrarTickOnline(fn) { hookTickOnline = fn; }

export function tick() {
  const agora = Date.now() + estado.relogio.offset;
  const geral = $id('mesa-relogio');
  if (geral) geral.textContent = estado.relogio.ini ? 'Mesa ' + formatarTempo(agora - estado.relogio.ini) : '';
  if (estado.partidaAtual && estado.partidaAtual.modo === 'online') {
    atualizarResumoTopoOnline();
    if (hookTickOnline) hookTickOnline();
    return;
  }
  const turno = $id('tempo-turno');
  if (turno) turno.textContent = estado.relogio.vez ? formatarTempo(agora - estado.relogio.vez) : 'VEZ';
}

export function recalcularLayoutMesa() {
  if (!estado.ultimoEstado || !estado.partidaAtual) return;
  if (estado.partidaAtual.modo !== 'online') return;
  if (!$id('tela-mesa').classList.contains('ativa')) return;
  desenharMesa(estado.ultimoEstado);
}

export function iniciarRelogio() {
  setInterval(tick, 1000);
}

// ----- Sair da mesa / voltar / encerrar sala -----
export async function sairDaMesa() {
  if (estado.ocupado || !estado.partidaAtual || !estado.meuJogadorId || !estado.meuSegredo) return;
  if (!confirm('Sair da mesa? Suas fichas ficam guardadas e você volta com elas se entrar de novo.')) return;

  estado.ocupado = true;
  const partidaId = estado.partidaAtual.id;
  let resp;
  try {
    resp = await banco.rpc('sair_da_sala', { p_jogador: estado.meuJogadorId, p_segredo: estado.meuSegredo });
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }
  estado.ocupado = false;

  if (resp.error) {
    mostrarErro('erro-barra', resp.error.message);
    return;
  }
  if (resp.data && resp.data.partida && canalAtivo()) {
    publicarBroadcast(resp.data);
  }
  esquecerSegredo(estado.minhaConta ? estado.minhaConta.id : null, partidaId);
  aviso('Você saiu da mesa. Fichas guardadas.');
  voltarParaSalas();
}

export function voltarParaSalas() {
  const eraDev = estado.modoDev;
  desligarTempoReal();
  fecharFolhas();
  limparChatMesa();
  const dock = $id('meu-perfil-dock');
  if (dock) { dock.hidden = true; dock.innerHTML = ''; }
  const espera = $id('barra-online-espera');
  if (espera) { espera.hidden = true; espera.innerHTML = ''; }
  $id('tela-mesa').classList.remove('hero-no-dock');
  const modo = obterModo(estado.modoAtual);
  if (modo && modo.aoSairDaMesa) modo.aoSairDaMesa();

  estado.partidaAtual = null;
  estado.meuJogadorId = null;
  estado.meuSegredo = null;
  limparCachesMesa();
  esquecerPartida();
  estado.modoDev = false;
  hooksApp.abrirSalas();
  if (eraDev) hooksApp.apagarSalaDev();
}

export function encerrarSala() {
  return executar('encerrar_sala', Object.assign({}, contaParams(), {
    p_partida_id: estado.partidaAtual.id
  }), 'erro-criador').then((ok) => {
    if (ok && estado.partidaAtual) voltarParaSalas();
    return ok;
  });
}
