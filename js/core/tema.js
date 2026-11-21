// Gerenciamento de tema visual ('azul' = Azul Royal | 'classico' = Cassino Sinuca | 'preto' = Preto & Vermelho | 'liberdade' = Americano Clássico)
const CHAVE_TEMA = 'poker-tema';
const ORDEM_TEMAS = ['azul', 'classico', 'preto', 'liberdade'];
const CORES_META = {
  azul: '#0c1d45',
  classico: '#1b130e',
  preto: '#14161c',
  liberdade: '#0a3161'
};
const TITULOS_TEMA = {
  azul: 'Tema: Azul Americano (clique para trocar para Cassino)',
  classico: 'Tema: Cassino (clique para trocar para Preto e Vermelho)',
  preto: 'Tema: Preto e Vermelho (clique para trocar para Americano Clássico)',
  liberdade: 'Tema: Americano Clássico (clique para trocar para Azul Americano)'
};

function normalizarTema(tema) {
  return ORDEM_TEMAS.includes(tema) ? tema : 'azul';
}

export function lerTemaSalvo() {
  try {
    return normalizarTema(localStorage.getItem(CHAVE_TEMA));
  } catch (erro) {
    return 'azul';
  }
}

function aplicarTemaDOM(tema) {
  const ativo = normalizarTema(tema);
  if (ativo === 'azul') document.documentElement.removeAttribute('data-tema');
  else document.documentElement.setAttribute('data-tema', ativo);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', CORES_META[ativo]);

  document.querySelectorAll('.tema-btn[data-tema]').forEach((btn) => {
    const sel = btn.dataset.tema === ativo;
    btn.classList.toggle('sel', sel);
    btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
  });

  const btnTopo = document.getElementById('btn-tema-mesa');
  if (btnTopo) btnTopo.title = TITULOS_TEMA[ativo];
}

export function escolherTema(tema) {
  const ativo = normalizarTema(tema);
  try { localStorage.setItem(CHAVE_TEMA, ativo); } catch (erro) {}
  aplicarTemaDOM(ativo);
}

export function alternarTema() {
  const atual = normalizarTema(document.documentElement.getAttribute('data-tema'));
  const prox = ORDEM_TEMAS[(ORDEM_TEMAS.indexOf(atual) + 1) % ORDEM_TEMAS.length];
  escolherTema(prox);
}

export function iniciarTema() {
  aplicarTemaDOM(lerTemaSalvo());
}
