// Modo Presencial (baralho físico): ações do criador, blinds, abertura de rodadas e registro do modo
import { estado, QUALQUER_UM_ABRE_RODADA, nomeDe, credC, passoSala } from '../../core/estado.js';
import { $id, escapar, fmtNum, aviso, mostrarErro, limparErro, abrirFolha, fecharFolhas, atualizarFundo, novoUuid } from '../../core/ui.js';
import { executar, modoEnviando } from '../../mesa/apostas.js';
import { registrarModo } from '../../mesa/modos.js';
import { fecharDistribuicao } from './distribuir.js';

export function abrirCriador() {
  limparErro('erro-criador');
  abrirFolha('painel-criador');
}

export function aoDigitarSmallMesa() {
  const s = parseInt($id('campo-small-mesa').value);
  if (!estado.bigMesaEditado && s > 0) $id('campo-big-mesa').value = s * 2;
}

export function aoEditarBigMesa() {
  estado.bigMesaEditado = true;
}

export async function salvarBlinds() {
  const small = parseInt($id('campo-small-mesa').value);
  const big = parseInt($id('campo-big-mesa').value);
  if (!(small > 0) || !(big > 0)) {
    mostrarErro('erro-criador', 'Os blinds precisam ser números maiores que zero.');
    return;
  }
  if (big < small) {
    mostrarErro('erro-criador', 'O big blind não pode ser menor que o small blind.');
    return;
  }
  const deuCerto = await executar('alterar_blinds', {
    p_jogador: credC().id,
    p_segredo: credC().segredo,
    p_small: small,
    p_big: big
  }, 'erro-criador');
  if (deuCerto) { aviso('Blinds: ' + small + ' / ' + big); fecharFolhas(); }
}

export function abrirRodada() {
  return executar('abrir_rodada', {
    p_jogador: credC().id,
    p_segredo: credC().segredo
  }, 'erro-faixa');
}

export function moverJogador(id, direcao) {
  return executar('mover_jogador', {
    p_jogador: credC().id,
    p_segredo: credC().segredo,
    p_alvo: id,
    p_dir: direcao
  }, 'erro-criador');
}

export function iniciarPartida() {
  return executar('iniciar_partida', {
    p_jogador: credC().id,
    p_segredo: credC().segredo
  }, 'erro-criador').then((ok) => { if (ok) fecharFolhas(); return ok; });
}

export function iniciarOuProximaMao() {
  if (estado.partidaAtual && estado.partidaAtual.aguardando_proxima_mao) {
    return executar('proxima_mao', {
      p_jogador: credC().id,
      p_segredo: credC().segredo
    }, 'erro-faixa');
  }
  return iniciarPartida();
}

export function pagarBlind() {
  return executar('pagar_blind', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo
  }, 'erro-barra', modoEnviando);
}

export function usarStackFichas() {
  if (estado.partidaAtual) $id('campo-fichas-valor').value = estado.partidaAtual.saldo_inicial;
}

export function adicionarFichas() {
  if (!estado.partidaAtual) return;
  const alvoId = $id('sel-fichas-jogador').value;
  const valor = parseInt($id('campo-fichas-valor').value);
  const alvo = estado.jogadoresAtuais.find((j) => j.id === alvoId);
  if (!alvo) { mostrarErro('erro-criador', 'Escolha um jogador.'); return; }
  if (!(valor > 0)) { mostrarErro('erro-criador', 'Informe uma quantidade de fichas maior que zero.'); return; }
  const passo = passoSala();
  if (passo > 1 && valor % passo !== 0) {
    mostrarErro('erro-criador', 'Nesta sala as fichas devem ser múltiplas de ' + fmtNum(passo) + '.');
    return;
  }
  if (!confirm('Adicionar ' + fmtNum(valor) + ' fichas a ' + nomeDe(alvo.nome)
    + '?\nSaldo: ' + fmtNum(alvo.saldo) + ' → ' + fmtNum(alvo.saldo + valor))) return;

  const chave = alvoId + ':' + valor;
  if (!estado.opFichas || estado.opFichasChave !== chave) {
    estado.opFichas = novoUuid();
    estado.opFichasChave = chave;
  }
  return executar('adicionar_fichas', {
    p_jogador: credC().id,
    p_segredo: credC().segredo,
    p_alvo: alvoId,
    p_valor: valor,
    p_op: estado.opFichas
  }, 'erro-criador').then((ok) => {
    if (ok) {
      estado.opFichas = null;
      estado.opFichasChave = '';
      $id('campo-fichas-valor').value = '';
      aviso('+' + fmtNum(valor) + ' fichas para ' + nomeDe(alvo.nome));
    }
    return ok;
  });
}

export function removerJogador(idDoJogador) {
  const alvo = estado.jogadoresAtuais.find((j) => j.id === idDoJogador);
  const nome = alvo ? alvo.nome : 'este jogador';
  if (!confirm('Remover ' + nome + ' da sala? As fichas dele ficam guardadas e ele volta com elas se entrar de novo.')) return;
  return executar('remover_jogador', {
    p_jogador: credC().id,
    p_segredo: credC().segredo,
    p_alvo: idDoJogador
  }, 'erro-criador');
}

export function resetarPartida() {
  return executar('resetar_partida', {
    p_jogador: credC().id,
    p_segredo: credC().segredo
  }, 'erro-criador').then((ok) => { if (ok) { fecharFolhas(); aviso('Partida resetada'); } return ok; });
}

export function subirNivel() {
  return executar('subir_nivel', {
    p_jogador: credC().id,
    p_segredo: credC().segredo
  }, 'erro-criador').then((ok) => {
    if (ok && estado.partidaAtual) {
      fecharFolhas();
      aviso('Nível ' + estado.partidaAtual.nivel + ': blinds '
        + estado.partidaAtual.small_blind + '/' + estado.partidaAtual.big_blind);
    }
    return ok;
  });
}

// Registra o modo 'presencial' no contrato compartilhado da mesa
registrarModo('presencial', {
  desenharBoard(partida) {
    const boardEl = $id('board');
    if (boardEl.classList.contains('online')) {
      boardEl.classList.remove('online');
      boardEl.querySelector('.slots').innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    }
    const acesas = [0, 3, 4, 5, 5][partida.fase] || 0;
    const novasDe = [0, 0, 3, 4, 5][partida.fase];
    document.querySelectorAll('#board .slots i').forEach((el, k) => {
      el.classList.toggle('on', partida.iniciada && k < acesas);
      el.classList.toggle('novo', partida.iniciada && partida.aguardando_cartas && k >= novasDe && k < acesas);
    });
    document.querySelectorAll('#board .rotulos span').forEach((el) => {
      el.classList.toggle('atual', partida.iniciada && Number(el.dataset.f) === partida.fase);
    });
  },

  desenharFaixa(partida, _jogadores, { eu, souCriador, potesMesa, nomesFase }) {
    const faixaOnline = $id('faixa-online');
    if (faixaOnline) { faixaOnline.hidden = true; faixaOnline.innerHTML = ''; }
    const minhaMao = $id('minha-mao-wrap');
    if (minhaMao) { minhaMao.hidden = true; minhaMao.innerHTML = ''; }
    const timerWrap = $id('timer-turno-wrap');
    if (timerWrap) timerWrap.hidden = true;

    const faixaOn = partida.iniciada && partida.fase_blind === 0 && (partida.aguardando_cartas || partida.fase === 4);
    $id('faixa-fase').hidden = !faixaOn;
    if (faixaOn) {
      $id('faixa-texto').textContent = partida.fase === 4
        ? 'SHOWDOWN: mostrem as cartas'
        : nomesFase[partida.fase].toUpperCase() + ': '
          + ['', 'virem 3 cartas', 'vire a 4ª carta', 'vire a 5ª carta'][partida.fase];
    }
    $id('btn-abrir-rodada').hidden =
      !((souCriador || (QUALQUER_UM_ABRE_RODADA && !!eu)) && partida.aguardando_cartas);
    const btnDistFaixa = $id('btn-distribuir-faixa');
    btnDistFaixa.hidden = !(souCriador && faixaOn && partida.fase === 4 && partida.pote > 0);
    if (!btnDistFaixa.hidden) {
      btnDistFaixa.textContent = (potesMesa && potesMesa.length >= 2)
        ? 'Distribuir potes (' + potesMesa.length + ')'
        : 'Distribuir pote';
    }
  },

  desenharCriador(partida, jogadores, { eu, souCriador }) {
    $id('btn-criador').hidden = !souCriador;
    const btnSair = $id('btn-sair-mesa');
    btnSair.hidden = !eu || souCriador || estado.modoDev;
    btnSair.disabled = partida.iniciada && !partida.aguardando_proxima_mao;
    btnSair.title = btnSair.disabled ? 'Só dá para sair entre as mãos' : 'Sair da mesa';
    if (!souCriador) { $id('painel-criador').hidden = true; atualizarFundo(); }

    const btnIni = $id('btn-iniciar-rapido');
    const pausa = partida.iniciada && partida.aguardando_proxima_mao;
    const comFichasAgora = jogadores.filter((j) => j.saldo > 0).length;
    btnIni.hidden = !(souCriador && (!partida.iniciada || (pausa && comFichasAgora >= 2)));
    btnIni.disabled = !pausa && jogadores.length < 2;
    btnIni.textContent = pausa
      ? 'Próxima mão'
      : (jogadores.length < 2
          ? 'Aguardando mais jogadores…'
          : 'Iniciar partida (' + jogadores.length + ' jogadores)');

    const podeRemover = !partida.iniciada || partida.aguardando_proxima_mao;
    const podeMexerNaOrdem = !partida.iniciada;
    $id('bloco-ordem').hidden = !podeRemover || jogadores.length < 2;
    const htmlOrdem = jogadores.map((j) => {
      let linha = '<div class="linha-ordem"><span>' + j.ordem + '. ' + escapar(nomeDe(j.nome)) + '</span>';
      if (podeMexerNaOrdem) {
        linha += '<button class="secundario" onclick="moverJogador(\'' + j.id + '\',-1)" aria-label="Subir">▲</button>'
              +  '<button class="secundario" onclick="moverJogador(\'' + j.id + '\',1)" aria-label="Descer">▼</button>';
      }
      if (!j.criador) {
        linha += '<button class="contorno-perigo remover" onclick="removerJogador(\'' + j.id + '\')">Remover</button>';
      }
      return linha + '</div>';
    }).join('');
    if (htmlOrdem !== estado.htmlOrdemVisto) {
      estado.htmlOrdemVisto = htmlOrdem;
      $id('lista-ordem').innerHTML = htmlOrdem;
    }

    $id('bloco-fichas').hidden = !podeRemover;
    const sel = $id('sel-fichas-jogador');
    const htmlSel = jogadores.map((j) => (
      '<option value="' + j.id + '">' + escapar(nomeDe(j.nome)) + ' · ' + j.saldo + ' fichas</option>'
    )).join('');
    if (htmlSel !== estado.htmlSelFichasVisto) {
      const escolhido = sel.value;
      estado.htmlSelFichasVisto = htmlSel;
      sel.innerHTML = htmlSel;
      if (escolhido && jogadores.some((j) => j.id === escolhido)) sel.value = escolhido;
    }
    $id('btn-fichas-stack').textContent = '1 stack (' + fmtNum(partida.saldo_inicial) + ')';
    const passoF = passoSala();
    $id('dica-fichas').textContent = passoF > 1 ? 'Nesta sala, múltiplos de ' + fmtNum(passoF) + ' fichas.' : '';

    $id('bloco-blinds').hidden = partida.iniciada;
    const chaveBlinds = partida.small_blind + '/' + partida.big_blind;
    if (chaveBlinds !== estado.blindsVistos) {
      estado.blindsVistos = chaveBlinds;
      $id('campo-small-mesa').value = partida.small_blind;
      $id('campo-big-mesa').value = partida.big_blind;
      estado.bigMesaEditado = false;
    }
    $id('dica-iniciar').hidden = partida.iniciada;
    $id('botao-iniciar').hidden = partida.iniciada;
    $id('botao-distribuir').hidden = !partida.iniciada;
    $id('botao-distribuir').disabled = !(partida.pote > 0);
    $id('botao-nivel').disabled = partida.pote > 0;
    $id('botao-encerrar').hidden = estado.modoDev;

    if (!souCriador || !(partida.pote > 0)) fecharDistribuicao();
  },

  aoSairDaMesa() {
    fecharDistribuicao();
  }
});
