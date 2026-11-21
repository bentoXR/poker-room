// Configuração de nova sala (stack, blinds, profundidade em BB e referência em R$)
// Compartilhada por todos os modos (Presencial, DEV e futuro Online)
import { banco } from '../core/supabase.js?v=59';
import { estado, marcarReal } from '../core/estado.js?v=59';
import { $id, fmtNum, fmtReais, aviso } from '../core/ui.js?v=59';

const STACKS = { 1000: [5, 10], 2000: [10, 20], 5000: [25, 50], 10000: [50, 100] };
const cfgReal = { '': false, dev: false };
const cfgModo = { '': 'presencial', dev: 'presencial' };
const cfgTempoTurno = { '': 30, dev: 30 };
const cfgSubirBlinds = { '': 0, dev: 0 };

function idsCfg(p) {
  return p
    ? { saldo: 'campo-dev-saldo', small: 'campo-dev-small', big: 'campo-dev-big', s: '-dev' }
    : { saldo: 'campo-saldo', small: 'campo-small', big: 'campo-big', s: '' };
}

export function obterConfigOnline(p) {
  p = p || '';
  return {
    modo: cfgModo[p] || 'presencial',
    tempoTurno: cfgTempoTurno[p] === 0 ? 0 : (cfgTempoTurno[p] || 30),
    subirBlindsMin: cfgSubirBlinds[p] || 0
  };
}

export function escolherModoSala(modo, p) {
  p = p || '';
  cfgModo[p] = modo === 'online' ? 'online' : 'presencial';
  const s = idsCfg(p).s;
  const wrap = $id('seletor-modo' + s);
  if (wrap) {
    wrap.querySelectorAll('.modo-btn').forEach((b) => {
      const ativo = b.dataset.modo === cfgModo[p];
      b.classList.toggle('sel', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }
  const op = $id('opcoes-online' + s);
  if (op) op.hidden = (cfgModo[p] !== 'online');
}

export function escolherTempoTurno(seg, p) {
  p = p || '';
  cfgTempoTurno[p] = Number(seg) === 0 ? 0 : (Number(seg) || 30);
  const wrap = $id('chips-turno' + idsCfg(p).s);
  if (wrap) {
    wrap.querySelectorAll('.op-chip').forEach((b) => {
      const ativo = Number(b.dataset.v) === cfgTempoTurno[p];
      b.classList.toggle('sel', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }
}

export function escolherSubirBlinds(min, p) {
  p = p || '';
  cfgSubirBlinds[p] = Number(min) || 0;
  const wrap = $id('chips-blinds' + idsCfg(p).s);
  if (wrap) {
    wrap.querySelectorAll('.op-chip').forEach((b) => {
      const ativo = Number(b.dataset.v) === cfgSubirBlinds[p];
      b.classList.toggle('sel', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }
}

export function escolherQtdDev(qtd) {
  const v = Math.max(2, Math.min(9, parseInt(qtd) || 4));
  const campo = $id('campo-dev-qtd');
  if (campo) campo.value = v;
  const wrap = $id('chips-dev-qtd');
  if (wrap) {
    wrap.querySelectorAll('.op-chip').forEach((b) => {
      const ativo = Number(b.dataset.q) === v;
      b.classList.toggle('sel', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }
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

function ajustarBlinds(p) {
  const i = idsCfg(p);
  const s = parseInt($id(i.saldo).value);
  if (s > 0) {
    const b = blinds100(s);
    $id(i.small).value = b[0];
    $id(i.big).value = b[1];
  }
  atualizarProfundidade(p);
}

export function aoEditarConfig() { setTimeout(() => ajustarBlinds(''), 0); }
export function aoEditarConfigDev() { setTimeout(() => ajustarBlinds('dev'), 0); }

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
  const bbs = ok ? (Math.round(s / bb * 10) / 10) : 0;
  const ritmo = !ok ? 'Ritmo da mesa'
    : (bbs < 40 ? 'Jogo rápido' : bbs <= 120 ? 'Equilibrado (padrão)' : 'Jogo longo');
  const rotuloEl = $id('prof-rotulo' + i.s);
  if (rotuloEl) rotuloEl.textContent = ritmo;
  $id('prof-val' + i.s).textContent = ok ? bbs.toLocaleString('pt-BR') + ' BB' : '—';
  $id('prof-det' + i.s).innerHTML = ok
    ? '<b>' + fmtNum(s) + '</b> fichas · Blinds <b>' + fmtNum(sb) + '/' + fmtNum(bb) + '</b>'
    : 'Informe fichas e blinds válidos';
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
  escolherModoSala('presencial', '');
  escolherModoSala('presencial', 'dev');
  escolherTempoTurno(30, '');
  escolherTempoTurno(30, 'dev');
  escolherSubirBlinds(0, '');
  escolherSubirBlinds(0, 'dev');
  escolherQtdDev(4);
}
