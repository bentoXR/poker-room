// Ponto de entrada da aplicação: conecta os módulos, expõe ações para o HTML e inicia o app
import { banco } from './core/supabase.js?v=28';
import { estado } from './core/estado.js?v=28';
import { lerNome, lerPartidaSalva, esquecerPartida, lerDevSala } from './core/storage.js?v=28';
import {
  $id, TELAS_INTERNAS, mostrar, prepararCampoSenha, alternarSenha,
  algumaFolhaAberta, fecharFolhas, registrarHookSairSalas
} from './core/ui.js?v=28';
import { iniciarTema, escolherTema, alternarTema } from './core/tema.js?v=28';
import { iniciarSom, alternarSom } from './core/som.js?v=28';
import { canalAtivo, ligarTempoReal, enviarSinal } from './core/realtime.js?v=28';

import {
  registrarHooksAuth, escolherModoLogin, enviarAuth, fazerLogin, criarConta, sairDaConta
} from './lobby/auth.js?v=28';
import {
  abrirPerfil, fecharPerfil, perfilAberto, acionarEscolhaFoto, aoEscolherFotoPerfil,
  removerFotoPerfil, salvarNomePerfil, alterarSenhaPerfil, encerrarOutrasSessoes, limparCachePerfil
} from './lobby/perfil.js?v=28';
import {
  abrirSalas, pararSalas, carregarSalas, abrirSala, abrirCriar, criarSala, entrarComoJogador
} from './lobby/salas.js?v=28';
import {
  escolherStack, escolherStackDev, alternarReal, definirReais,
  aoEditarConfig, aoEditarConfigDev, atualizarProfundidade, iniciarConfigSala,
  escolherModoSala, escolherTempoTurno, escolherSubirBlinds, escolherQtdDev
} from './lobby/config-sala.js?v=28';

import {
  abrirMesa, buscarMesa, receberEstado, desenharMesa, iniciarRelogio, recalcularLayoutMesa,
  abrirMenuOnline, sairDaMesa, voltarParaSalas, encerrarSala, registrarHooksMesa, registrarTickOnline
} from './mesa/mesa.js?v=28';
import {
  agir, apostar, alternarAposta, ajustarAposta, apostaPote, apostaAllIn,
  aoMoverSlider, aoDigitarAposta
} from './mesa/apostas.js?v=28';
import {
  abrirHistorico, abrirReais, abrirGuia, abrirDetalhesPotes, carregarValorReal
} from './mesa/extras.js?v=28';

// Modos registrados: Presencial (baralho físico) e Online (baralho virtual)
import {
  abrirCriador, aoDigitarSmallMesa, aoEditarBigMesa, salvarBlinds, abrirRodada,
  moverJogador, iniciarPartida, iniciarOuProximaMao, pagarBlind, usarStackFichas,
  adicionarFichas, removerJogador, resetarPartida, subirNivel
} from './modos/presencial/acoes.js?v=28';
import {
  abrirDistribuicao, fecharDistribuicao, alternarGanhador, alternarVencedorPote,
  alternarModoManualDist, aoEditarPremioManual, confirmarDistribuicao
} from './modos/presencial/distribuir.js?v=28';
import {
  registrarHooksDev, abrirSalaDev, criarSalaDev, controlarDev, trocarJogadorDev,
  proximoJogadorDev, autoSeguirVezDev, abrirPainelDev, desenharPainelDev, adicionarJogadorDev,
  devAcao, apagarSalaDev, excluirSalaDev
} from './modos/presencial/dev.js?v=28';
import {
  virarMinhaCarta, confirmarMao, mostrarCartasOnline, revancheOnline,
  confirmarTodosDev, tickOnline, resetarOnlineUI
} from './modos/online/online.js?v=28';

// ----- Conexão entre módulos (sem ciclos) -----
registrarHookSairSalas(pararSalas);
registrarHooksAuth({
  abrirSalas,
  pararSalas,
  onLogout: () => { fecharPerfil(); limparCachePerfil(); }
});
registrarHooksMesa({ abrirSalas, controlarDev, desenharPainelDev, apagarSalaDev, autoSeguirVezDev });
registrarTickOnline(tickOnline);
registrarHooksDev({
  abrirSalas,
  pararSalas,
  abrirMesa,
  buscarMesa,
  voltarParaSalas,
  onTrocarJogador: resetarOnlineUI,
  onRedesenhar: () => { if (estado.ultimoEstado) desenharMesa(estado.ultimoEstado); }
});

// ----- Inicialização ao abrir a página -----
async function iniciarApp() {
  if (lerDevSala() && !estado.modoDev) apagarSalaDev();
  if (!estado.minhaConta) { mostrar('tela-login'); return; }

  const id = lerPartidaSalva();
  if (!id) { abrirSalas(); return; }

  mostrar('tela-carregando');
  $id('carregando-texto').textContent = 'Voltando para a mesa...';
  $id('carregando-acoes').hidden = true;

  let resp;
  try {
    resp = await banco.rpc('estado_mesa', { p_partida: id });
  } catch (erro) {
    resp = { error: erro };
  }

  if (resp.error) {
    $id('carregando-texto').textContent =
      'Não consegui falar com o servidor. Confira a internet e tente de novo.';
    $id('carregando-acoes').hidden = false;
    return;
  }

  if (!resp.data || !resp.data.partida || resp.data.partida.encerrada) {
    esquecerPartida();
    abrirSalas();
    return;
  }

  await abrirMesa(resp.data.partida, resp.data);
}

// ----- Ponte controlada para handlers declarados no HTML -----
Object.assign(window, {
  // Auth, perfil e lobby
  alternarSenha, escolherModoLogin, enviarAuth, fazerLogin, criarConta, sairDaConta,
  abrirPerfil, fecharPerfil, acionarEscolhaFoto, aoEscolherFotoPerfil,
  removerFotoPerfil, salvarNomePerfil, alterarSenhaPerfil, encerrarOutrasSessoes,
  escolherTema, alternarTema, alternarSom,
  abrirSalas, abrirCriar, criarSala, abrirSala, entrarComoJogador,
  escolherStack, escolherStackDev, alternarReal, definirReais,
  aoEditarConfig, aoEditarConfigDev, atualizarProfundidade,
  escolherModoSala, escolherTempoTurno, escolherSubirBlinds, escolherQtdDev,
  esquecerPartida, iniciarApp,

  // Mesa compartilhada e apostas
  voltarParaSalas, sairDaMesa, encerrarSala, abrirMenuOnline,
  abrirHistorico, abrirReais, abrirGuia, abrirDetalhesPotes, fecharFolhas,
  agir, apostar, alternarAposta, ajustarAposta, apostaPote, apostaAllIn,
  aoMoverSlider, aoDigitarAposta,

  // Modo presencial (criador, blinds, distribuição e DEV)
  abrirCriador, aoDigitarSmallMesa, aoEditarBigMesa, salvarBlinds, abrirRodada,
  moverJogador, iniciarPartida, iniciarOuProximaMao, pagarBlind, usarStackFichas,
  adicionarFichas, removerJogador, resetarPartida, subirNivel,
  abrirDistribuicao, fecharDistribuicao, alternarGanhador, alternarVencedorPote,
  alternarModoManualDist, aoEditarPremioManual, confirmarDistribuicao,
  abrirSalaDev, criarSalaDev, trocarJogadorDev, proximoJogadorDev,
  abrirPainelDev, adicionarJogadorDev, devAcao, excluirSalaDev,

  // Modo online (baralho virtual, cartas 3D, confirmação e revanche)
  virarMinhaCarta, confirmarMao, mostrarCartasOnline, revancheOnline, confirmarTodosDev
});

// ----- Eventos globais e detalhes de conforto -----
iniciarTema();
iniciarSom();
$id('campo-login-nome').value = lerNome();
prepararCampoSenha('campo-login-senha');
prepararCampoSenha('campo-login-senha-conf');
prepararCampoSenha('campo-senha-atual');
prepararCampoSenha('campo-senha-nova');
prepararCampoSenha('campo-senha-nova-conf');
escolherModoLogin('entrar');
iniciarConfigSala();
iniciarRelogio();

const barraEl = $id('barra-acoes');
const mesaEl = $id('tela-mesa');
function ajustarEspaco() {
  const visivel = barraEl.classList.contains('visivel');
  const altura = visivel ? barraEl.offsetHeight : 0;
  const margemInf = visivel ? (parseFloat(getComputedStyle(barraEl).bottom) || 0) : 0;
  mesaEl.style.paddingBottom = altura ? (altura + margemInf + 8) + 'px' : 'calc(10px + env(safe-area-inset-bottom))';
}
if ('ResizeObserver' in window) new ResizeObserver(ajustarEspaco).observe(barraEl);
new MutationObserver(ajustarEspaco).observe(barraEl, { attributes: true, attributeFilter: ['class'] });

let timerResize = null;
window.addEventListener('resize', () => {
  clearTimeout(timerResize);
  timerResize = setTimeout(() => {
    recalcularLayoutMesa();
    ajustarEspaco();
  }, 120);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (perfilAberto()) fecharPerfil();
    else if (algumaFolhaAberta()) fecharFolhas();
  }
});

$id('campo-login-nome').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $id('campo-login-senha').focus();
});
$id('campo-login-senha').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const grpConf = $id('grupo-confirmar-senha');
    if (grpConf && !grpConf.hidden) $id('campo-login-senha-conf').focus();
    else enviarAuth();
  }
});
$id('campo-login-senha-conf').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') enviarAuth();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const naMesa = $id('tela-mesa').classList.contains('ativa');
  const nasSalas = $id('tela-salas').classList.contains('ativa');
  if (estado.partidaAtual && naMesa) {
    buscarMesa(false);
    const canal = canalAtivo();
    if (!canal || canal.state !== 'joined') {
      ligarTempoReal({ onEstado: receberEstado, onBuscar: buscarMesa, onConectado: carregarValorReal });
    }
    enviarSinal();
  } else if (nasSalas) {
    carregarSalas();
  }
});

window.addEventListener('online', () => {
  if (estado.partidaAtual && $id('tela-mesa').classList.contains('ativa')) buscarMesa(false);
});

window.addEventListener('popstate', () => {
  if (estado.ignorarPop) { estado.ignorarPop = false; return; }
  if (algumaFolhaAberta()) {
    fecharFolhas();
    try { history.pushState({ poker: 1 }, ''); } catch (erro) {}
    return;
  }
  estado.profundidade = 0;
  const ativa = document.querySelector('.tela.ativa');
  const id = ativa ? ativa.id : '';
  if (TELAS_INTERNAS.indexOf(id) >= 0) voltarParaSalas();
});

iniciarApp();
