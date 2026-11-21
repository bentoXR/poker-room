// Modo Presencial: distribuição do pote (mão normal, modo guiado por potes laterais e edição manual)
import { estado, nomeDe, credC } from '../../core/estado.js?v=19';
import { $id, escapar, limparErro, abrirFolha, atualizarFundo } from '../../core/ui.js?v=19';
import { nomePote, nomePoteLog, dividirValorPote, textoSobra, calcularPotes } from '../../core/potes.js?v=19';
import { executar } from '../../mesa/apostas.js?v=19';

export function abrirDistribuicao() {
  if (!estado.partidaAtual || !(estado.partidaAtual.pote > 0)) return;
  limparErro('erro-distribuir');

  $id('dist-pote').textContent = estado.partidaAtual.pote;

  let potesDist = null;
  if (estado.partidaAtual.fase === 4) {
    potesDist = calcularPotes(estado.jogadoresAtuais, estado.partidaAtual.pote, false);
  } else {
    const temAllIn = estado.jogadoresAtuais.some(
      (j) => !j.desistiu && (Number(j.saldo) || 0) === 0 && (Number(j.total_mao) || 0) > 0
    );
    if (temAllIn) potesDist = calcularPotes(estado.jogadoresAtuais, estado.partidaAtual.pote, true);
  }

  if (potesDist && potesDist.length >= 2) {
    estado.distEstado = {
      modo: 'potes',
      potes: potesDist,
      vencedores: potesDist.map((p) => (p.automatico ? [p.elegiveis[0].id] : [])),
      autoOrigem: potesDist.map((p) => (p.automatico ? -2 : -1)),
      sobraNota: ''
    };
    desenharDistribuicaoPotes();
  } else {
    estado.distEstado = { modo: 'simples', potes: null, vencedores: [], autoOrigem: [], sobraNota: '' };
    desenharDistribuicaoManual(null);
  }

  abrirFolha('painel-distribuir');
  $id('painel-distribuir').querySelector('.folha-corpo').scrollTop = 0;
}

export function desenharDistribuicaoPotes() {
  const dist = estado.distEstado;
  if (!dist || !dist.potes) return;
  const potes = dist.potes;
  const dica = $id('dist-dica');
  dica.textContent = 'Toque em quem ganhou cada pote. Em empate, marque todos os empatados.'
    + (estado.partidaAtual.fase < 4 ? ' Atenção: a mão ainda está em andamento.' : '');

  let html = potes.map((p, idx) => {
    const titulo = nomePote(idx, potes.length);
    const venc = dist.vencedores[idx] || [];
    const div = dividirValorPote(p.valor, venc, estado.jogadoresAtuais, estado.partidaAtual.dealer_jogador_id);

    let classeCard = 'pote-card';
    let badgeHtml = '';
    if (p.automatico) {
      classeCard += ' auto';
      badgeHtml = '<span class="pote-badge ok">Automático</span>';
    } else if (venc.length > 0) {
      classeCard += ' ok';
      badgeHtml = venc.length > 1
        ? '<span class="pote-badge ok">Empate (' + venc.length + ')</span>'
        : '<span class="pote-badge ok">✓ Definido</span>';
    } else {
      classeCard += ' pendente';
      badgeHtml = '<span class="pote-badge pendente">Escolha</span>';
    }

    let sub = '';
    if (p.automatico) sub = 'Único jogador na disputa (demais desistiram) — já garantido.';
    else if (p.morto > 0) sub = 'Inclui ' + p.morto + ' de quem desistiu';

    let corpo = '';
    if (p.automatico) {
      const j = p.elegiveis[0];
      corpo = '<div class="pote-auto-box"><span>' + escapar(nomeDe(j.nome)) + '</span><strong>+' + p.valor + '</strong></div>';
    } else {
      const botoes = p.elegiveis.map((j) => {
        const sel = venc.indexOf(j.id) >= 0;
        const ganho = sel ? div.mapa[j.id] : 0;
        return '<button type="button" class="pote-opcao ' + (sel ? 'positivo' : 'secundario') + '"'
          + ' onclick="alternarVencedorPote(' + idx + ',\'' + j.id + '\')">'
          + '<span class="op-nome">' + (sel ? '✓ ' : '') + escapar(nomeDe(j.nome)) + '</span>'
          + (sel ? '<span class="op-valor">+' + ganho + '</span>' : '')
          + '</button>';
      }).join('');
      corpo = '<div class="pote-escolhas' + (p.elegiveis.length === 1 ? ' um' : '') + '">' + botoes + '</div>';
    }

    let nota = '';
    if (dist.autoOrigem[idx] >= 0 && venc.length > 0) {
      nota = 'Preenchido automaticamente (venceu o pote anterior)';
    }
    if (venc.length > 1 && div.sobraPara.length > 0) {
      nota = (nota ? nota + ' · ' : '') + textoSobra(div.sobraPara);
    }

    return '<div class="' + classeCard + '">'
      + '<div class="pote-card-topo">'
      +   '<div class="pote-card-titulo">' + titulo + ' ' + badgeHtml + '</div>'
      +   '<div class="pote-card-valor">' + p.valor + '</div>'
      + '</div>'
      + (sub ? '<div class="pote-card-sub">' + sub + '</div>' : '')
      + corpo
      + (nota ? '<div class="pote-nota">' + escapar(nota) + '</div>' : '')
      + '</div>';
  }).join('');

  html += '<button type="button" class="dist-modo-btn" onclick="alternarModoManualDist(true)">Editar valores manualmente</button>';
  $id('dist-linhas').innerHTML = html;
  atualizarSoma();
}

export function alternarVencedorPote(indice, jogadorId) {
  const dist = estado.distEstado;
  if (!dist || dist.modo !== 'potes') return;
  const p = dist.potes[indice];
  if (!p || p.automatico) return;

  const atual = dist.vencedores[indice].slice();
  const pos = atual.indexOf(jogadorId);
  if (pos >= 0) atual.splice(pos, 1);
  else atual.push(jogadorId);
  dist.vencedores[indice] = atual;
  dist.autoOrigem[indice] = -1;

  for (let k = indice + 1; k < dist.potes.length; k++) {
    const pk = dist.potes[k];
    if (pk.automatico) continue;
    let fonte = -1;
    let inter = [];
    for (let a = k - 1; a >= 0; a--) {
      if (dist.potes[a].automatico) continue;
      const ws = dist.vencedores[a];
      if (!ws.length) continue;
      const comum = ws.filter((id) => pk.elegiveis.some((e) => e.id === id));
      if (comum.length) { fonte = a; inter = comum; break; }
    }
    if (fonte >= 0) {
      if (dist.autoOrigem[k] >= 0 || dist.vencedores[k].length === 0) {
        dist.vencedores[k] = inter;
        dist.autoOrigem[k] = fonte;
      }
    } else if (dist.autoOrigem[k] >= 0) {
      dist.vencedores[k] = [];
      dist.autoOrigem[k] = -1;
    }
  }

  desenharDistribuicaoPotes();
}

export function alternarModoManualDist(paraManual) {
  const dist = estado.distEstado;
  if (!dist || !dist.potes) return;
  if (paraManual) {
    const resumo = resumoDistribuicaoPotes();
    dist.modo = 'manual';
    desenharDistribuicaoManual(resumo.porJogador);
  } else {
    dist.modo = 'potes';
    desenharDistribuicaoPotes();
  }
}

export function desenharDistribuicaoManual(valoresIniciais) {
  const dist = estado.distEstado;
  const dica = $id('dist-dica');
  dica.textContent = dist && dist.modo === 'manual'
    ? 'Modo manual: ajuste os valores de cada jogador como preferir.'
    : 'Toque em "Ganhou" nos vencedores. Com mais de um, o pote é dividido igualmente (e dá para ajustar os valores).';

  let html = '';
  if (dist && dist.modo === 'manual' && dist.potes && dist.potes.length >= 2) {
    html += '<button type="button" class="dist-modo-btn" style="margin-top:0;margin-bottom:10px" onclick="alternarModoManualDist(false)">← Voltar para potes separados</button>';
  }

  const ordenados = estado.jogadoresAtuais.slice().sort(
    (a, b) => (Number(a.desistiu) - Number(b.desistiu)) || (a.ordem - b.ordem)
  );
  ordenados.forEach((j) => {
    const valIni = (valoresIniciais && valoresIniciais[j.id] > 0) ? valoresIniciais[j.id] : '';
    html += `
      <div class="linha-premio">
        <div class="nome"><span class="texto">${escapar(nomeDe(j.nome))}</span>${j.esperando ? ' <span class="voce">(esperando)</span>' : j.desistiu ? ' <span class="voce">(desistiu)</span>' : ''}</div>
        <input type="number" inputmode="numeric" min="0" placeholder="0" value="${valIni}"
               data-jogador="${j.id}" oninput="aoEditarPremioManual()">
        <button type="button" class="secundario" data-jogador="${j.id}" data-ativo="0" onclick="alternarGanhador('${j.id}')">Ganhou</button>
      </div>
    `;
  });
  $id('dist-linhas').innerHTML = html;
  atualizarSoma();
}

export function aoEditarPremioManual() {
  if (estado.distEstado) estado.distEstado.sobraNota = '';
  atualizarSoma();
}

export function alternarGanhador(idDoJogador) {
  const botao = document.querySelector('#dist-linhas button[data-jogador="' + idDoJogador + '"]');
  if (!botao) return;
  const ativo = botao.dataset.ativo !== '1';
  botao.dataset.ativo = ativo ? '1' : '0';
  botao.classList.toggle('positivo', ativo);
  botao.classList.toggle('secundario', !ativo);
  dividirEntreGanhadores();
}

function dividirEntreGanhadores() {
  const pote = estado.partidaAtual.pote;
  const ganhadores = Array.prototype.map.call(
    document.querySelectorAll('#dist-linhas button[data-ativo="1"]'),
    (b) => b.dataset.jogador
  );
  const div = dividirValorPote(pote, ganhadores, estado.jogadoresAtuais, estado.partidaAtual.dealer_jogador_id);
  if (estado.distEstado) estado.distEstado.sobraNota = ganhadores.length > 1 ? textoSobra(div.sobraPara) : '';

  document.querySelectorAll('#dist-linhas input').forEach((campo) => {
    const val = div.mapa[campo.dataset.jogador];
    campo.value = val > 0 ? val : '';
  });
  atualizarSoma();
}

export function resumoDistribuicaoPotes() {
  const porJogador = {};
  const detalhesPorJogador = {};
  const pendentes = [];
  const dist = estado.distEstado;
  const potes = (dist && dist.potes) ? dist.potes : [];

  potes.forEach((p, idx) => {
    const venc = dist.vencedores[idx] || [];
    if (!venc.length) { pendentes.push(idx); return; }
    const div = dividirValorPote(p.valor, venc, estado.jogadoresAtuais, estado.partidaAtual.dealer_jogador_id);
    const label = nomePoteLog(idx, potes.length) + (venc.length > 1 ? ' - empate' : '');
    venc.forEach((id) => {
      const ganho = div.mapa[id] || 0;
      if (ganho > 0) {
        porJogador[id] = (porJogador[id] || 0) + ganho;
        if (!detalhesPorJogador[id]) detalhesPorJogador[id] = [];
        detalhesPorJogador[id].push(label);
      }
    });
  });

  const premios = [];
  estado.jogadoresAtuais.forEach((j) => {
    if (porJogador[j.id] > 0) {
      premios.push({
        jogador_id: j.id,
        nome: nomeDe(j.nome),
        valor: porJogador[j.id],
        detalhe: detalhesPorJogador[j.id].join(' + ')
      });
    }
  });
  return { porJogador, premios, pendentes };
}

export function lerPremios() {
  if (estado.distEstado && estado.distEstado.modo === 'potes') {
    return resumoDistribuicaoPotes().premios.map((p) => ({
      jogador_id: p.jogador_id,
      valor: p.valor,
      detalhe: p.detalhe
    }));
  }
  const premios = [];
  document.querySelectorAll('#dist-linhas input').forEach((campo) => {
    const valor = parseInt(campo.value);
    if (valor > 0) premios.push({ jogador_id: campo.dataset.jogador, valor });
  });
  return premios;
}

export function atualizarSoma() {
  const pote = estado.partidaAtual.pote;
  const caixa = $id('dist-soma');
  const botao = $id('botao-confirmar-dist');
  const resumoEl = $id('dist-resumo');

  if (estado.distEstado && estado.distEstado.modo === 'potes') {
    const res = resumoDistribuicaoPotes();
    const soma = res.premios.reduce((s, p) => s + p.valor, 0);
    if (res.premios.length > 0) {
      resumoEl.innerHTML = res.premios.map((p) => (
        '<span class="dist-resumo-chip">' + escapar(p.nome) + '<b>+' + p.valor + '</b></span>'
      )).join('');
      resumoEl.hidden = false;
    } else {
      resumoEl.innerHTML = '';
      resumoEl.hidden = true;
    }

    if (res.pendentes.length === 1) {
      caixa.textContent = 'Escolha quem ganhou o ' + nomePote(res.pendentes[0], estado.distEstado.potes.length);
      caixa.className = 'soma';
      botao.disabled = true;
    } else if (res.pendentes.length > 1) {
      caixa.textContent = 'Falta escolher o vencedor de ' + res.pendentes.length + ' potes';
      caixa.className = 'soma';
      botao.disabled = true;
    } else if (soma === pote) {
      caixa.textContent = 'Tudo pronto: ' + soma + ' de ' + pote;
      caixa.className = 'soma ok';
      botao.disabled = false;
    } else {
      caixa.textContent = 'Soma (' + soma + ') difere do pote (' + pote + ')';
      caixa.className = 'soma';
      botao.disabled = true;
    }
    return;
  }

  if (resumoEl) { resumoEl.innerHTML = ''; resumoEl.hidden = true; }
  let soma = 0;
  lerPremios().forEach((p) => { soma += p.valor; });
  const resta = pote - soma;

  if (resta === 0) {
    const extra = (estado.distEstado && estado.distEstado.sobraNota) ? ' · ' + estado.distEstado.sobraNota : '';
    caixa.textContent = 'Soma confere: ' + soma + ' de ' + pote + extra;
    caixa.className = 'soma ok';
  } else if (resta > 0) {
    caixa.textContent = 'Faltam ' + resta + ' para distribuir';
    caixa.className = 'soma';
  } else {
    caixa.textContent = 'Passou ' + (-resta) + ' do pote';
    caixa.className = 'soma';
  }
  botao.disabled = (resta !== 0);
}

export async function confirmarDistribuicao() {
  const deuCerto = await executar('distribuir_pote', {
    p_jogador: credC().id,
    p_segredo: credC().segredo,
    p_premios: lerPremios()
  }, 'erro-distribuir');
  if (deuCerto) fecharDistribuicao();
}

export function fecharDistribuicao() {
  $id('painel-distribuir').hidden = true;
  $id('dist-linhas').innerHTML = '';
  const res = $id('dist-resumo');
  if (res) { res.innerHTML = ''; res.hidden = true; }
  estado.distEstado = null;
  limparErro('erro-distribuir');
  atualizarFundo();
}
