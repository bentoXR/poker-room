// Configuração de nova sala (stack, blinds, profundidade em BB e referência em R$)
// Compartilhada por todos os modos (Presencial, DEV e futuro Online)
import { banco } from '../core/supabase.js';
import { estado, marcarReal } from '../core/estado.js';
import { $id, fmtNum, fmtReais, aviso } from '../core/ui.js';

const STACKS = { 1000: [5, 10], 2000: [10, 20], 5000: [25, 50], 10000: [50, 100] };
const cfgReal = { '': false, dev: false };

function idsCfg(p) {
  return p
    ? { saldo: 'campo-dev-saldo', small: 'campo-dev-small', big: 'campo-dev-big', s: '-dev' }
    : { saldo: 'campo-saldo', small: 'campo-small', big: 'campo-big', s: '' };
}

function blinds100(s) {
  const sb = Math.max(1, Math.round(s / 200));
  return [sb, Math.max(sb + 1, Math.round(s / 100))];
}

function aplicarConfig(p, s, sb, bb) {
  const i = idsCfg(p);
  $id(i.saldo).value = s;
  $id(i.small).value = sb;
  $id(i.big).value = bb;
  if (!p) estado.bigEditado = false;
  atualizarProfundidade(p);
}

export function escolherStack(s) { aplicarConfig('', s, STACKS[s][0], STACKS[s][1]); }
export function escolherStackDev(s) { aplicarConfig('dev', s, STACKS[s][0], STACKS[s][1]); }

export function alternarReal(p) {
  cfgReal[p] = !cfgReal[p];
  if (cfgReal[p]) {
    const s = parseInt($id(idsCfg(p).saldo).value) || 1000;
    const b = blinds100(s);
    aplicarConfig(p, s, b[0], b[1]);
  } else {
    atualizarProfundidade(p);
  }
}

export function definirReais(v, p) {
  $id('campo-reais' + idsCfg(p).s).value = v;
  atualizarProfundidade(p);
}

function ajustarReal(p) {
  const i = idsCfg(p);
  const s = parseInt($id(i.saldo).value);
  if (cfgReal[p] && s > 0) {
    const b = blinds100(s);
    $id(i.small).value = b[0];
    $id(i.big).value = b[1];
  }
  atualizarProfundidade(p);
}

export function aoEditarConfig() { setTimeout(() => ajustarReal(''), 0); }
export function aoEditarConfigDev() { setTimeout(() => ajustarReal('dev'), 0); }

export function atualizarProfundidade(p) {
  p = p || '';
  const i = idsCfg(p);
  const real = cfgReal[p];
  const s = parseInt($id(i.saldo).value);
  const sb = parseInt($id(i.small).value);
  const bb = parseInt($id(i.big).value);

  $id(i.small).readOnly = real;
  $id(i.big).readOnly = real;
  document.querySelectorAll('#stacks' + i.s + ' .stack').forEach((b) => {
    const k = Number(b.dataset.s);
    b.classList.toggle('sel', s === k && sb === STACKS[k][0] && bb === STACKS[k][1]);
  });
  $id('stack-real' + i.s).classList.toggle('sel', real);
  $id('painel-real' + i.s).hidden = !real;

  const reais = parseFloat($id('campo-reais' + i.s).value);
  $id('reais-res' + i.s).textContent = (real && s > 0 && reais > 0)
    ? fmtNum(s) + ' fichas = ' + fmtReais(reais) + ' · 1.000 fichas = ' + fmtReais(reais / s * 1000) + '. Apenas referência.'
    : '';
  const ok = s > 0 && bb > 0;
  $id('prof-val' + i.s).textContent = ok ? (Math.round(s / bb * 10) / 10).toLocaleString('pt-BR') + ' BB' : '—';
  $id('prof-det' + i.s).textContent = ok ? 'Stack ' + fmtNum(s) + ' · Big blind ' + fmtNum(bb) : 'Informe stack e blinds';
}

export async function registrarRealCriacao(p, id, saldo, jid, seg) {
  const reais = parseFloat($id('campo-reais' + idsCfg(p).s).value);
  if (!(cfgReal[p] && reais > 0 && saldo > 0)) return;
  const v = Math.round(reais / saldo * 1000 * 1e6) / 1e6;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await banco.rpc('definir_valor_real', { p_jogador: jid, p_segredo: seg, p_valor: v });
      if (!r.error) { marcarReal(id, v); return; }
      estado.erroReal = r.error.message;
    } catch (erro) {}
    await new Promise((ok) => setTimeout(ok, 600));
  }
  aviso('Não consegui salvar o valor em reais: ' + estado.erroReal);
}

export function iniciarConfigSala() {
  const campoSmall = $id('campo-small');
  const campoBig = $id('campo-big');
  campoBig.addEventListener('input', () => { estado.bigEditado = true; });
  campoSmall.addEventListener('input', () => {
    const s = parseInt(campoSmall.value);
    if (!estado.bigEditado && s > 0) campoBig.value = s * 2;
  });
  atualizarProfundidade('');
  atualizarProfundidade('dev');
}
