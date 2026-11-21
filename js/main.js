// Ponto de entrada da aplicação: conecta os módulos, expõe ações para o HTML e inicia o app
import { banco } from './core/supabase.js';
import { estado } from './core/estado.js';
import { lerNome, lerPartidaSalva, esquecerPartida, lerDevSala } from './core/storage.js';
import {
  $id, TELAS_INTERNAS, mostrar, prepararCampoSenha, alternarSenha,
  algumaFolhaAberta, fecharFolhas, registrarHookSairSalas
} from './core/ui.js';
import { canalAtivo, ligarTempoReal, enviarSinal } from './core/realtime.js';

import { registrarHooksAuth, fazerLogin, criarConta, sairDaConta } from './lobby/auth.js';
import {
  abrirSalas, pararSalas, carregarSalas, abrirSala, abrirCriar, criarSala, entrarComoJogador
} from './lobby/salas.js';
import {
  escolherStack, escolherStackDev, alternarReal, definirReais,
  aoEditarConfig, aoEditarConfigDev, atualizarProfundidade, iniciarConfigSala
} from './lobby/config-sala.js';

import {
  abrirMesa, buscarMesa, receberEstado, iniciarRelogio,
  sairDaMesa, voltarParaSalas, encerrarSala, registrarHooksMesa
} from './mesa/mesa.js';
import {
  agir, apostar, alternarAposta, ajustarAposta, apostaPote, apostaAllIn,
  aoMoverSlider, aoDigitarAposta
} from './mesa/apostas.js';
import {
  abrirHistorico, abrirReais, abrirGuia, abrirDetalhesPotes, carregarValorReal
} from './mesa/extras.js';

// Modos registrados (hoje: presencial; futuramente bastará importar './modos/online/...' aqui)
import {
  abrirCriador, aoDigitarSmallMesa, aoEditarBigMesa, salvarBlinds, abrirRodada,
  moverJogador, iniciarPartida, iniciarOuProximaMao, pagarBlind, usarStackFichas,
  adicionarFichas, removerJogador, resetarPartida, subirNivel
} from './modos/presencial/acoes.js';
import {
  abrirDistribuicao, fecharDistribuicao, alternarGanhador, alternarVencedorPote,
  alternarModoManualDist, aoEditarPremioManual, confirmarDistribuicao
} from './modos/presencial/distribuir.js';
import {
  registrarHooksDev, abrirSalaDev, criarSalaDev, controlarDev, trocarJogadorDev,
  proximoJogadorDev, abrirPainelDev, desenharPainelDev, adicionarJogadorDev,
  devAcao, apagarSalaDev, excluirSalaDev
} from './modos/presencial/dev.js';

// ----- Conexão entre módulos (sem ciclos) -----
registrarHookSairSalas(pararSalas);
registrarHooksAuth({ abrirSalas, pararSalas });
registrarHooksMesa({ abrirSalas, controlarDev, desenharPainelDev, apagarSalaDev });
registrarHooksDev({ abrirSalas, pararSalas, abrirMesa, buscarMesa, voltarParaSalas });

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
  // Auth e lobby
  alternarSenha, fazerLogin, criarConta, sairDaConta,
  abrirSalas, abrirCriar, criarSala, abrirSala, entrarComoJogador,
  escolherStack, escolherStackDev, alternarReal, definirReais,
  aoEditarConfig, aoEditarConfigDev, atualizarProfundidade,
  esquecerPartida, iniciarApp,

  // Mesa compartilhada e apostas
  voltarParaSalas, sairDaMesa, encerrarSala,
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
  abrirPainelDev, adicionarJogadorDev, devAcao, excluirSalaDev
});

// ----- Eventos globais e detalhes de conforto -----
$id('campo-login-nome').value = lerNome();
prepararCampoSenha('campo-login-senha');
iniciarConfigSala();
iniciarRelogio();

const barraEl = $id('barra-acoes');
const mesaEl = $id('tela-mesa');
function ajustarEspaco() {
  const altura = barraEl.classList.contains('visivel') ? barraEl.offsetHeight : 0;
  mesaEl.style.paddingBottom = altura ? (altura + 6) + 'px' : 'calc(10px + env(safe-area-inset-bottom))';
}
if ('ResizeObserver' in window) new ResizeObserver(ajustarEspaco).observe(barraEl);
new MutationObserver(ajustarEspaco).observe(barraEl, { attributes: true, attributeFilter: ['class'] });

$id('campo-login-nome').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $id('campo-login-senha').focus();
});
$id('campo-login-senha').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fazerLogin();
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
