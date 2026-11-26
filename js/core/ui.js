// Utilitários de interface: navegação entre telas, gavetas (.folha), toast, erros, formatação
import { estado } from './estado.js?v=107';

export const $id = (id) => document.getElementById(id);

export const TELAS_INTERNAS = ['tela-criar', 'tela-dev', 'tela-escolha', 'tela-mesa'];
const TELAS_RAIZ = ['tela-login', 'tela-salas'];

export const FOLHAS = [
  'folha-menu',
  'painel-criador',
  'painel-distribuir',
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

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapar(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

let temporizadorAviso = null;
export function aviso(texto) {
  const el = $id('toast');
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('visivel'), 2200);
}

const FMT_NUM = new Intl.NumberFormat('pt-BR');
const FMT_REAIS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

export function fmtNum(n) {
  return FMT_NUM.format(Number(n));
}

export function fmtReais(v) {
  return FMT_REAIS.format(Number(v));
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
  return FOLHAS.some((id) => {
    const el = $id(id);
    return el && !el.hidden;
  });
}

export function atualizarFundo() {
  const fundo = $id('fundo-folha');
  if (fundo) fundo.hidden = !algumaFolhaAberta();
}

export function abrirFolha(id) {
  FOLHAS.forEach((outro) => {
    const el = $id(outro);
    if (el) el.hidden = (outro !== id);
  });
  atualizarFundo();
}

export function fecharFolhas() {
  FOLHAS.forEach((id) => {
    const el = $id(id);
    if (el) el.hidden = true;
  });
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

// ----- Diálogo de confirmação estilizado do site -----
let resolverConfirmacao = null;

export function confirmarDialogoAberto() {
  const f = $id('folha-confirmar');
  return !!(f && !f.hidden);
}

export function fecharConfirmarDialogo(resultado = false) {
  const f = $id('folha-confirmar');
  const bg = $id('fundo-confirmar');
  if (f) f.hidden = true;
  if (bg) bg.hidden = true;
  if (resolverConfirmacao) {
    const fn = resolverConfirmacao;
    resolverConfirmacao = null;
    fn(!!resultado);
  }
}

export function confirmarDialogo(opcoesOuMensagem) {
  const opts = typeof opcoesOuMensagem === 'string'
    ? { mensagem: opcoesOuMensagem }
    : (opcoesOuMensagem || {});

  const f = $id('folha-confirmar');
  const bg = $id('fundo-confirmar');
  if (!f || !bg) return Promise.resolve(window.confirm(opts.mensagem || 'Confirmar?'));

  if (resolverConfirmacao) fecharConfirmarDialogo(false);

  const tituloEl = $id('confirmar-titulo');
  const msgEl = $id('confirmar-mensagem');
  const btnOk = $id('btn-confirmar-ok');
  const btnCanc = $id('btn-confirmar-cancelar');
  const btnFechar = $id('btn-confirmar-fechar');

  if (tituloEl) tituloEl.textContent = opts.titulo || 'Confirmar';
  if (msgEl) msgEl.textContent = opts.mensagem || '';
  if (btnCanc) btnCanc.textContent = opts.textoCancelar || 'Cancelar';
  if (btnOk) {
    btnOk.textContent = opts.textoConfirmar || 'Confirmar';
    btnOk.className = opts.perigo ? 'perigo' : '';
  }

  return new Promise((resolve) => {
    resolverConfirmacao = resolve;
    if (btnOk) btnOk.onclick = () => fecharConfirmarDialogo(true);
    if (btnCanc) btnCanc.onclick = () => fecharConfirmarDialogo(false);
    if (btnFechar) btnFechar.onclick = () => fecharConfirmarDialogo(false);
    bg.onclick = () => fecharConfirmarDialogo(false);
    bg.hidden = false;
    f.hidden = false;
    if (btnOk) setTimeout(() => { try { btnOk.focus(); } catch (e) {} }, 20);
  });
}
