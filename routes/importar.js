// Importação de professores e horários a partir de Excel/CSV (ou lista colada), com pré-visualização.
// Só para o Administrador da escola (garantido por verificarPermissao).
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { lerFicheiro, lerTexto, mapearLinhas, sanitizarLinhas } = require('../config/importacao/leitura');
const { analisarProfessores, gravarProfessores } = require('../config/importacao/professores');
const { analisarHorarios, gravarHorarios } = require('../config/importacao/horarios');
const { gerarModelo } = require('../config/importacao/modelos');

const TIPOS = {
  professores: { analisar: analisarProfessores, gravar: gravarProfessores, titulo: 'Professores', destino: '/professores' },
  horarios: { analisar: analisarHorarios, gravar: gravarHorarios, titulo: 'Horários', destino: '/horarios' }
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

// Recebe o ficheiro sem rebentar a página quando é grande demais
function receberFicheiro(req, res, next) {
  upload.single('ficheiro')(req, res, (err) => {
    if (err) req.erroUpload = err.code === 'LIMIT_FILE_SIZE' ? 'O ficheiro tem mais de 2 MB.' : 'Não foi possível receber o ficheiro.';
    next();
  });
}

const opcoesDoPedido = (body) => ({
  criarEmFalta: body.criar_em_falta === '1',
  criarProfessores: body.criar_professores === '1',
  substituir: body.substituir === '1'
});

function renderInicio(res, extra = {}) {
  res.render('importar/index', {
    pageTitle: 'Importar dados',
    activePage: 'importar',
    success: null,
    error: null,
    ...extra
  });
}

router.get('/', (req, res) => renderInicio(res, { success: req.query.success || null }));

// MODELOS .xlsx (já com as disciplinas, turmas e professores da escola)
router.get('/modelo/:tipo', async (req, res, next) => {
  try {
    if (!TIPOS[req.params.tipo]) return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });
    const wb = await gerarModelo(req.escolaId, req.params.tipo, res.locals.escola.cor);
    const sigla = String(res.locals.escola.sigla || 'escola').replace(/[^\w-]+/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="modelo_${req.params.tipo}_${sigla}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// PRÉ-VISUALIZAÇÃO: lê o ficheiro (ou a lista colada) e mostra o que vai acontecer em cada linha
router.post('/:tipo/previa', receberFicheiro, async (req, res, next) => {
  try {
    const tipo = req.params.tipo;
    const def = TIPOS[tipo];
    if (!def) return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });
    if (req.erroUpload) return renderInicio(res.status(400), { error: req.erroUpload });

    let tabela;
    let origem;
    if (req.file && req.file.size) {
      const lido = await lerFicheiro(req.file, tipo);
      if (lido.erro) return renderInicio(res.status(400), { error: lido.erro });
      tabela = lido.tabela;
      origem = req.file.originalname;
    } else if (tipo === 'professores' && String(req.body.texto || '').trim()) {
      tabela = lerTexto(req.body.texto);
      origem = 'Lista colada';
    } else {
      return renderInicio(res.status(400), { error: 'Escolha um ficheiro (ou cole uma lista) antes de continuar.' });
    }

    const { linhas, erro } = mapearLinhas(tipo, tabela, { colado: origem === 'Lista colada' });
    if (erro) return renderInicio(res.status(400), { error: erro });
    if (!linhas.length) return renderInicio(res.status(400), { error: 'Não encontrei linhas com dados. Confirme que preencheu a folha certa do modelo.' });

    const opcoes = opcoesDoPedido(req.body);
    const analise = await def.analisar(req.escolaId, linhas, opcoes);

    res.render('importar/previa', {
      pageTitle: `Pré-visualização · ${def.titulo}`,
      activePage: 'importar',
      tipo,
      origem,
      opcoes,
      analise,
      dados: JSON.stringify(linhas)
    });
  } catch (err) {
    next(err);
  }
});

// CONFIRMAR: volta a analisar (os dados podem ter mudado entretanto) e grava tudo numa transação
router.post('/:tipo/confirmar', async (req, res, next) => {
  try {
    const tipo = req.params.tipo;
    const def = TIPOS[tipo];
    if (!def) return res.status(404).render('404', { pageTitle: 'Não encontrado', activePage: '' });

    const linhas = sanitizarLinhas(tipo, req.body.dados);
    if (!linhas || !linhas.length) return renderInicio(res.status(400), { error: 'Os dados da importação perderam-se. Carregue o ficheiro outra vez.' });

    const analise = await def.analisar(req.escolaId, linhas, opcoesDoPedido(req.body));
    if (!analise.resumo.validas) return renderInicio(res.status(400), { error: 'Não há linhas válidas para importar.' });

    const c = await def.gravar(req.escolaId, analise);
    const partes = tipo === 'professores'
      ? [`${c.criados} professor(es) criado(s)`, c.atualizados && `${c.atualizados} atualizado(s)`]
      : [`${c.aulas} aula(s) importada(s)`, c.apagadas && `${c.apagadas} aula(s) antiga(s) substituída(s)`, c.professoresCriados && `${c.professoresCriados} professor(es) criado(s)`];
    partes.push(c.disciplinasCriadas && `${c.disciplinasCriadas} disciplina(s) nova(s)`, c.turmasCriadas && `${c.turmasCriadas} turma(s) nova(s)`);

    const ignoradas = analise.resumo.erro + analise.resumo.ignorada;
    const msg = `Importação concluída: ${partes.filter(Boolean).join(', ')}.${ignoradas ? ` ${ignoradas} linha(s) não importada(s).` : ''}`;
    res.redirect(`${def.destino}?success=${encodeURIComponent(msg)}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
