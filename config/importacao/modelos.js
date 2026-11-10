// Ficheiros-modelo (.xlsx) para importar professores e horários, já com as listas da escola
const ExcelJS = require('exceljs');
const { DIAS_SEMANA, SLOTS_LETIVOS } = require('../horarioSlots');
const { catalogoEscola } = require('./comum');
const { COR_PADRAO } = require('../cores');

const LINHAS_COM_LISTAS = 1000;

function estilizarCabecalho(folha, cor) {
  const argb = `FF${cor.replace('#', '')}`;
  const linha = folha.getRow(1);
  linha.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  linha.height = 22;
  linha.alignment = { vertical: 'middle' };
  folha.views = [{ state: 'frozen', ySplit: 1 }];
}

function folhaInstrucoes(wb, titulo, linhas) {
  const f = wb.addWorksheet('Instruções');
  f.columns = [{ width: 110 }];
  f.addRow([titulo]).font = { bold: true, size: 14 };
  f.addRow([]);
  linhas.forEach((t) => {
    const r = f.addRow([t]);
    r.alignment = { wrapText: true };
    if (t.startsWith('•') === false && t.endsWith(':')) r.font = { bold: true };
  });
  return f;
}

// Folha "Listas" com os nomes atuais da escola; devolve o intervalo de cada coluna para as listas pendentes
function folhaListas(wb, colunas) {
  const f = wb.addWorksheet('Listas');
  const intervalos = {};
  colunas.forEach(({ titulo, valores }, i) => {
    const letra = String.fromCharCode(65 + i);
    f.getColumn(i + 1).width = 34;
    f.getCell(`${letra}1`).value = titulo;
    valores.forEach((v, j) => { f.getCell(`${letra}${j + 2}`).value = v; });
    if (valores.length) intervalos[titulo] = `Listas!$${letra}$2:$${letra}$${valores.length + 1}`;
  });
  estilizarCabecalho(f, '#6B7280');
  return intervalos;
}

// Lista pendente numa coluna; "livre" permite escrever valores fora da lista (ex.: uma turma nova)
function listaPendente(folha, coluna, formula, { livre = false, titulo = '', erro = '' } = {}) {
  folha.dataValidations.add(`${coluna}2:${coluna}${LINHAS_COM_LISTAS}`, {
    type: 'list',
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: !livre,
    errorStyle: 'stop',
    errorTitle: titulo,
    error: erro
  });
}

async function gerarModelo(escolaId, tipo, corEscola) {
  const cor = corEscola || COR_PADRAO;
  const cat = await catalogoEscola(escolaId);
  const ordenar = (arr) => [...arr].sort((a, b) => a.localeCompare(b, 'pt'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gestão Escolar';

  if (tipo === 'professores') {
    const f = wb.addWorksheet('Professores');
    f.columns = [
      { header: 'Nome *', key: 'nome', width: 34 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Telefone', key: 'telefone', width: 16 },
      { header: 'Disciplinas', key: 'disciplinas', width: 38 },
      { header: 'Turmas', key: 'turmas', width: 30 }
    ];
    estilizarCabecalho(f, cor);
    f.getColumn('telefone').numFmt = '@';

    folhaInstrucoes(wb, 'Importar professores', [
      'Preencha a folha "Professores": uma linha por professor. Só o nome é obrigatório.',
      '',
      'Colunas:',
      '• Nome — nome completo do professor.',
      '• Email e Telefone — opcionais.',
      '• Disciplinas — uma ou mais, separadas por vírgulas. Ex.: Matemática, Física',
      '• Turmas — uma ou mais, separadas por vírgulas. Ex.: 10ºA, 10ºB, 11º ASIBD1',
      '',
      'Dicas:',
      '• Veja na folha "Listas" os nomes das disciplinas e turmas que já existem na escola.',
      '• Disciplinas e turmas que ainda não existem podem ser criadas automaticamente durante a importação.',
      '• Se um professor já existir (mesmo email, ou mesmo nome), não é duplicado: só lhe são acrescentadas as disciplinas e turmas novas.',
      '• Antes de gravar, o site mostra uma pré-visualização com os erros de cada linha.'
    ]);
    folhaListas(wb, [
      { titulo: 'Disciplinas da escola', valores: ordenar(cat.disciplinas.map((d) => d.nome)) },
      { titulo: 'Turmas da escola', valores: ordenar(cat.turmas.map((t) => t.nome)) }
    ]);
  } else {
    const f = wb.addWorksheet('Horários');
    f.columns = [
      { header: 'Turma *', key: 'turma', width: 16 },
      { header: 'Dia *', key: 'dia', width: 14 },
      { header: 'Início *', key: 'inicio', width: 10 },
      { header: 'Fim', key: 'fim', width: 10 },
      { header: 'Disciplina *', key: 'disciplina', width: 28 },
      { header: 'Professor *', key: 'professor', width: 32 },
      { header: 'Sala', key: 'sala', width: 14 }
    ];
    estilizarCabecalho(f, cor);
    f.getColumn('inicio').numFmt = '@';
    f.getColumn('fim').numFmt = '@';

    folhaInstrucoes(wb, 'Importar horários', [
      'Preencha a folha "Horários": uma linha por aula (um bloco, ou vários blocos seguidos).',
      '',
      'Colunas:',
      '• Turma — ex.: 10ºA ou 11º ASIBD1.',
      '• Dia — Segunda a Sexta (escolha na lista).',
      `• Início — hora de início, ex.: 07:30. Blocos da escola: ${SLOTS_LETIVOS.map((s) => `${s.inicio}–${s.fim}`).join(', ')}.`,
      '• Fim — opcional: se ficar vazio, a aula ocupa um bloco. Para uma aula de 2 blocos, indique o fim do 2.º bloco.',
      '• Disciplina e Professor — escolha na lista ou escreva o nome. Se houver dois professores com o mesmo nome, use o email.',
      '• Sala — opcional.',
      '',
      'Dicas:',
      '• Importe primeiro os professores (modelo de professores) e depois os horários.',
      '• O site verifica conflitos: a mesma turma, professor ou sala em duas aulas ao mesmo tempo.',
      '• Pode escolher "substituir o horário das turmas do ficheiro" para refazer o horário de uma turma do zero.',
      '• Antes de gravar, o site mostra uma pré-visualização com os erros de cada linha.'
    ]);
    const intervalos = folhaListas(wb, [
      { titulo: 'Turmas da escola', valores: ordenar(cat.turmas.map((t) => t.nome)) },
      { titulo: 'Disciplinas da escola', valores: ordenar(cat.disciplinas.map((d) => d.nome)) },
      { titulo: 'Professores da escola', valores: ordenar(cat.professores.map((p) => p.nome)) }
    ]);

    listaPendente(f, 'B', `"${DIAS_SEMANA.map((d) => d.label.replace('-feira', '')).join(',')}"`,
      { titulo: 'Dia inválido', erro: 'Escolha um dia de Segunda a Sexta.' });
    listaPendente(f, 'C', `"${SLOTS_LETIVOS.map((s) => s.inicio).join(',')}"`, { livre: true });
    listaPendente(f, 'D', `"${[...new Set(SLOTS_LETIVOS.map((s) => s.fim))].join(',')}"`, { livre: true });
    if (intervalos['Turmas da escola']) listaPendente(f, 'A', intervalos['Turmas da escola'], { livre: true });
    if (intervalos['Disciplinas da escola']) listaPendente(f, 'E', intervalos['Disciplinas da escola'], { livre: true });
    if (intervalos['Professores da escola']) listaPendente(f, 'F', intervalos['Professores da escola'], { livre: true });
  }

  // Ordem das folhas: dados (a preencher), Instruções, Listas
  return wb;
}

module.exports = { gerarModelo };
