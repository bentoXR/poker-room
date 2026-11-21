// Gerenciamento de tema visual ('classico' = Sinuca [padrão] | 'cassino' = Cassino | 'preto' = Preto & Vermelho | 'liberdade' = EUA | 'tropical' = Praia Tropical)
const CHAVE_TEMA = 'poker-tema';
const ORDEM_TEMAS = ['classico', 'cassino', 'preto', 'liberdade', 'tropical'];
const CORES_META = {
  classico: '#1a100a',
  cassino: '#18060a',
  preto: '#14161c',
  liberdade: '#0a3161',
  tropical: '#04384f'
};
const TITULOS_TEMA = {
  classico: 'Tema: Sinuca (clique para trocar para Cassino)',
  cassino: 'Tema: Cassino (clique para trocar para Preto)',
  preto: 'Tema: Preto (clique para trocar para USA)',
  liberdade: 'Tema: USA (clique para trocar para Tropical)',
  tropical: 'Tema: Tropical (clique para trocar para Sinuca)'
};

function normalizarTema(tema) {
  return ORDEM_TEMAS.includes(tema) ? tema : 'classico';
}

export function lerTemaSalvo() {
  try {
    return normalizarTema(localStorage.getItem(CHAVE_TEMA));
  } catch (erro) {
    return 'classico';
  }
}

function aplicarTemaDOM(tema) {
  const ativo = normalizarTema(tema);
  document.documentElement.setAttribute('data-tema', ativo);

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
