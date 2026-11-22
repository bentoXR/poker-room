// Utilitários de interface: navegação entre telas, gavetas (.folha), toast, erros, formatação
import { estado } from './estado.js?v=97';

export const $id = (id) => document.getElementById(id);

export const TELAS_INTERNAS = ['tela-criar', 'tela-dev', 'tela-escolha', 'tela-mesa'];
const TELAS_RAIZ = ['tela-login', 'tela-salas'];

export const FOLHAS = [
  'folha-menu',
  'painel-criador',
  'painel-distribuir',
  'folha-hist',
  'folha-chat',
  'painel-dev',
  'folha-reais',
  'folha-guia',
  'folha-potes'
];

let onSairDeSalas = null;
export function registrarHookSairSalas(fn) { onSairDeSalas = fn; }

export function mostrar(idDaTela) {
  document.documentElement.classList.remove('restaurando');
  document.querySelectorAll('.tela').forEach((tela) => tela.classList.remove('ativa'));
  $id(idDaTela).classList.add('ativa');

  document.body.classList.toggle('na-mesa', idDaTela === 'tela-mesa');
  if (idDaTela !== 'tela-mesa') {
    document.body.classList.remove('modo-online');
    $id('tela-mesa').classList.remove('modo-online', 'apostando');
    $id('barra-acoes').classList.remove('visivel', 'modo-online', 'apostando');
  }
  if (idDaTela !== 'tela-salas' && onSairDeSalas) onSairDeSalas();
  ajustarHistorico(idDaTela);
  window.scrollTo(0, 0);
}

export function ajustarHistorico(idDaTela) {
  if (TELAS_INTERNAS.indexOf(idDaTela) >= 0) {
    if (estado.profundidade === 0) {
      try { history.pushState({ poker: 1 }, ''); } catch (erro) {}
      estado.profundidade = 1;
    }
  } else if (TELAS_RAIZ.indexOf(idDaTela) >= 0) {
    if (estado.profundidade === 1) {
      estado.profundidade = 0;
      estado.ignorarPop = true;
      try { history.back(); } catch (erro) { estado.ignorarPop = false; }
    }
  }
}

export function mostrarErro(idDaCaixa, texto) {
  const caixa = $id(idDaCaixa);
  caixa.textContent = texto;
  caixa.classList.add('visivel');
  if (!caixa.getClientRects().length) aviso(texto);
}

export function limparErro(idDaCaixa) {
  $id(idDaCaixa).classList.remove('visivel');
}

export function escapar(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

let temporizadorAviso = null;
export function aviso(texto) {
  const el = $id('toast');
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('visivel'), 2200);
}

export function fmtNum(n) {
  return Number(n).toLocaleString('pt-BR');
}

export function fmtReais(v) {
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
}

// Senha mascarada por CSS (evita prompt de salvar senha do navegador)
const SUPORTA_MASCARA = !!(window.CSS && CSS.supports && CSS.supports('-webkit-text-security', 'disc'));

export function prepararCampoSenha(idDoCampo) {
  if (!SUPORTA_MASCARA) $id(idDoCampo).type = 'password';
}

export function alternarSenha(idDoCampo, botao) {
  const campo = $id(idDoCampo);
  let revelado;
  if (SUPORTA_MASCARA) {
    revelado = !campo.classList.contains('revelada');
    campo.classList.toggle('revelada', revelado);
  } else {
    revelado = campo.type === 'password';
    campo.type = revelado ? 'text' : 'password';
  }
  botao.textContent = revelado ? 'Ocultar' : 'Mostrar';
}

// Gavetas (.folha)
export function algumaFolhaAberta() {
  return FOLHAS.some((id) => !$id(id).hidden);
}

export function atualizarFundo() {
  $id('fundo-folha').hidden = !algumaFolhaAberta();
}

export function abrirFolha(id) {
  FOLHAS.forEach((outro) => { $id(outro).hidden = (outro !== id); });
  atualizarFundo();
}

export function fecharFolhas() {
  FOLHAS.forEach((id) => { $id(id).hidden = true; });
  atualizarFundo();
}

export function novoUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.prototype.map.call(b, (x) => ('0' + x.toString(16)).slice(-2)).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
