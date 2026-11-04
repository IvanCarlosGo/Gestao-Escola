const express = require('express');
const path = require('path');
const PDFDocument = require('pdfkit');
const router = express.Router();
const { pool } = require('../config/db');

const PASTA_PUBLICA = path.join(__dirname, '..', 'public');

// Logótipo da escola (caminho em /img/...) convertido para ficheiro local; null se não houver ou for inválido
function ficheiroLogo(logo) {
  if (!logo || !/^\/img\/[\w./-]+$/.test(logo) || logo.includes('..')) return null;
  return path.join(PASTA_PUBLICA, logo);
}

const dataPt = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// Filtros partilhados pelo PDF e pelo CSV (período, professor, estado)
async function obterFaltasFiltradas(escolaId, query) {
  const { data_inicio, data_fim, professor_id, estado } = query;
  let where = ' WHERE f.escola_id = ? ';
  const params = [escolaId];
  const descricao = [];

  if (data_inicio) { where += ' AND f.data_falta >= ? '; params.push(data_inicio); }
  if (data_fim) { where += ' AND f.data_falta <= ? '; params.push(data_fim); }
  if (data_inicio || data_fim) {
    descricao.push(`Período: ${data_inicio ? dataPt(data_inicio) : 'início'} a ${data_fim ? dataPt(data_fim) : 'hoje'}`);
  } else {
    descricao.push('Período: todas as datas');
  }

  if (professor_id) {
    where += ' AND f.professor_id = ? ';
    params.push(professor_id);
    const [[prof]] = await pool.query('SELECT nome FROM professores WHERE id = ? AND escola_id = ?', [professor_id, escolaId]);
    if (prof) descricao.push(`Professor: ${prof.nome}`);
  }

  if (estado === 'justificada') { where += ' AND f.justificada = 1 '; descricao.push('Estado: justificadas'); }
  if (estado === 'injustificada') { where += ' AND f.justificada = 0 '; descricao.push('Estado: não justificadas'); }

  const [faltas] = await pool.query(
    `SELECT f.*, p.nome AS professor
     FROM faltas f
     JOIN professores p ON p.id = f.professor_id
     ${where}
     ORDER BY f.data_falta DESC, p.nome ASC`,
    params
  );

  return { faltas, descricao };
}

function sufixoFicheiro(query) {
  const partes = [query.data_inicio, query.data_fim].filter(Boolean);
  return partes.length ? `_${partes.join('_a_')}` : '';
}

router.get('/', async (req, res, next) => {
  try {
    const e = req.escolaId;
    const [[resumo]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM professores WHERE escola_id = ? AND ativo = 1) AS totalProfessores,
        (SELECT COUNT(*) FROM turmas WHERE escola_id = ?) AS totalTurmas,
        (SELECT COUNT(*) FROM disciplinas WHERE escola_id = ?) AS totalDisciplinas,
        (SELECT COUNT(*) FROM faltas WHERE escola_id = ?) AS totalFaltas,
        (SELECT COUNT(*) FROM faltas WHERE escola_id = ? AND justificada = 1) AS totalJustificadas,
        (SELECT COUNT(*) FROM faltas WHERE escola_id = ? AND YEAR(data_falta) = YEAR(CURDATE())) AS totalFaltasAno
    `, [e, e, e, e, e, e]);

    const [porDisciplina] = await pool.query(`
      SELECT d.nome, COUNT(f.id) AS total
      FROM disciplinas d
      LEFT JOIN professor_disciplinas pd ON pd.disciplina_id = d.id
      LEFT JOIN faltas f ON f.professor_id = pd.professor_id
      WHERE d.escola_id = ?
      GROUP BY d.id
      ORDER BY total DESC
      LIMIT 8
    `, [e]);

    const [professores] = await pool.query('SELECT id, nome FROM professores WHERE escola_id = ? ORDER BY nome ASC', [e]);

    const taxaJustificacao = resumo.totalFaltas > 0
      ? Math.round((resumo.totalJustificadas / resumo.totalFaltas) * 100)
      : 0;

    res.render('relatorios', {
      pageTitle: 'Relatórios',
      activePage: 'relatorios',
      resumo,
      porDisciplina,
      professores,
      taxaJustificacao
    });
  } catch (err) {
    next(err);
  }
});

// EXPORTAR CSV (abre no Excel: separador ";" e BOM UTF-8 para os acentos)
router.get('/exportar.csv', async (req, res, next) => {
  try {
    const { faltas } = await obterFaltasFiltradas(req.escolaId, req.query);

    const celula = (valor) => {
      const texto = String(valor ?? '').replace(/\r?\n/g, ' ');
      return /[";]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    };

    // O motivo (e as observações, que costumam descrevê-lo) não entram no relatório
    const linhas = [
      ['Data', 'Professor', 'Tipo', 'Início', 'Fim', 'Estado', 'Substituto'],
      ...faltas.map((f) => [
        dataPt(f.data_falta),
        f.professor,
        f.tipo === 'atraso' ? 'Atraso' : 'Falta',
        f.hora_inicio ? f.hora_inicio.slice(0, 5) : '',
        f.hora_fim ? f.hora_fim.slice(0, 5) : '',
        f.justificada ? 'Justificada' : 'Não justificada',
        f.substituto
      ])
    ].map((linha) => linha.map(celula).join(';'));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_faltas${sufixoFicheiro(req.query)}.csv"`);
    res.send('﻿' + linhas.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

// EXPORTAR PDF (resumo + faltas por professor + lista detalhada)
router.get('/exportar.pdf', async (req, res, next) => {
  try {
    const { faltas, descricao } = await obterFaltasFiltradas(req.escolaId, req.query);

    const total = faltas.length;
    const justificadas = faltas.filter((f) => f.justificada).length;
    const naoJustificadas = total - justificadas;
    const taxa = total ? Math.round((justificadas / total) * 100) : 0;

    const porProfessor = Object.values(faltas.reduce((acc, f) => {
      acc[f.professor_id] = acc[f.professor_id] || { nome: f.professor, total: 0, justificadas: 0 };
      acc[f.professor_id].total++;
      if (f.justificada) acc[f.professor_id].justificadas++;
      return acc;
    }, {})).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

    const NOME_ESCOLA = res.locals.escola.nome;
    const LOGO = ficheiroLogo(res.locals.escola.logo);
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: 'Relatório de Faltas', Author: NOME_ESCOLA } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_faltas${sufixoFicheiro(req.query)}.pdf"`);
    doc.pipe(res);

    const VERDE = '#223C2F';
    const CINZA = '#6b7280';
    const LINHA = '#e5e8ef';
    const esq = doc.page.margins.left;
    const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const limiteInferior = () => doc.page.height - doc.page.margins.bottom - 30;

    // Cabeçalho
    if (LOGO) {
      try { doc.image(LOGO, esq, 36, { width: 56 }); } catch (e) { /* logótipo ilegível: segue sem ele */ }
    }
    doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(16).text('Relatório de Faltas dos Professores', esq + 70, 42);
    doc.fillColor(CINZA).font('Helvetica').fontSize(10).text(NOME_ESCOLA, esq + 70, 63);
    doc.fontSize(9).text(`Gerado em ${new Date().toLocaleDateString('pt-PT')} às ${new Date().toTimeString().slice(0, 5)}`, esq + 70, 78);
    doc.moveTo(esq, 104).lineTo(esq + largura, 104).strokeColor(VERDE).lineWidth(1.5).stroke();

    doc.y = 114;
    doc.fillColor('#374151').fontSize(9.5).text(descricao.join('   ·   '), esq, doc.y, { width: largura });

    // Cartões de resumo
    const cartoes = [
      ['Total de faltas', String(total), '#111827'],
      ['Justificadas', String(justificadas), '#15803d'],
      ['Não justificadas', String(naoJustificadas), '#dc2626'],
      ['Taxa de justificação', `${taxa}%`, VERDE]
    ];
    const yCartoes = doc.y + 12;
    const gap = 10;
    const larguraCartao = (largura - gap * 3) / 4;
    cartoes.forEach(([label, valor, cor], i) => {
      const x = esq + i * (larguraCartao + gap);
      doc.roundedRect(x, yCartoes, larguraCartao, 52, 6).fillAndStroke('#f8fafc', LINHA);
      doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text(label, x + 10, yCartoes + 9, { width: larguraCartao - 20 });
      doc.fillColor(cor).font('Helvetica-Bold').fontSize(17).text(valor, x + 10, yCartoes + 24, { width: larguraCartao - 20 });
    });
    doc.y = yCartoes + 68;

    // Tabela genérica com cabeçalho repetido em cada página
    function tabela(titulo, colunas, linhas, { corLinha } = {}) {
      if (doc.y > limiteInferior() - 60) doc.addPage();
      doc.fillColor('#172033').font('Helvetica-Bold').fontSize(11.5).text(titulo, esq, doc.y);
      doc.y += 6;

      const cabecalho = () => {
        const y = doc.y;
        doc.rect(esq, y, largura, 20).fill('#f1f5f2');
        let x = esq;
        colunas.forEach((c) => {
          doc.fillColor('#4b5563').font('Helvetica-Bold').fontSize(8.5)
            .text(c.titulo, x + 6, y + 6, { width: c.largura - 12, align: c.align || 'left' });
          x += c.largura;
        });
        doc.y = y + 20;
      };

      cabecalho();
      if (linhas.length === 0) {
        doc.fillColor(CINZA).font('Helvetica-Oblique').fontSize(9).text('Sem registos para os filtros escolhidos.', esq + 6, doc.y + 8);
        doc.y += 26;
        return;
      }

      linhas.forEach((linha) => {
        doc.font('Helvetica').fontSize(9);
        const altura = Math.max(18, ...colunas.map((c, i) => doc.heightOfString(String(linha[i] ?? ''), { width: c.largura - 12 }) + 8));
        if (doc.y + altura > limiteInferior()) { doc.addPage(); cabecalho(); }
        const y = doc.y;
        let x = esq;
        colunas.forEach((c, i) => {
          const cor = (corLinha && corLinha(linha, i)) || '#1f2937';
          doc.fillColor(cor).font('Helvetica').fontSize(9)
            .text(String(linha[i] ?? ''), x + 6, y + 5, { width: c.largura - 12, align: c.align || 'left' });
          x += c.largura;
        });
        doc.moveTo(esq, y + altura).lineTo(esq + largura, y + altura).strokeColor(LINHA).lineWidth(0.5).stroke();
        doc.y = y + altura;
      });
      doc.y += 18;
    }

    tabela('Faltas por professor', [
      { titulo: 'Professor', largura: largura - 3 * 95 },
      { titulo: 'Total', largura: 95, align: 'center' },
      { titulo: 'Justificadas', largura: 95, align: 'center' },
      { titulo: 'Não justificadas', largura: 95, align: 'center' }
    ], porProfessor.map((p) => [p.nome, p.total, p.justificadas, p.total - p.justificadas]), {
      corLinha: (linha, i) => (i === 3 && linha[3] > 0 ? '#dc2626' : null)
    });

    // Sem a coluna do motivo: o relatório não expõe a razão da falta
    tabela('Lista de faltas', [
      { titulo: 'Data', largura: 72 },
      { titulo: 'Professor', largura: largura - 72 - 64 - 100 - 100 },
      { titulo: 'Tipo', largura: 64 },
      { titulo: 'Horário', largura: 100 },
      { titulo: 'Estado', largura: 100 }
    ], faltas.map((f) => [
      dataPt(f.data_falta),
      f.professor,
      f.tipo === 'atraso' ? 'Atraso' : 'Falta',
      f.hora_inicio ? `${f.hora_inicio.slice(0, 5)}–${f.hora_fim ? f.hora_fim.slice(0, 5) : ''}` : '—',
      f.justificada ? 'Justificada' : 'Não justificada'
    ]), {
      corLinha: (linha, i) => (i === 4 ? (linha[4] === 'Justificada' ? '#15803d' : '#dc2626') : null)
    });

    // Rodapé com numeração de páginas
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(i);
      const yRodape = doc.page.height - doc.page.margins.bottom - 12;
      doc.fillColor(CINZA).font('Helvetica').fontSize(8)
        .text(`${NOME_ESCOLA} · Gestão de Faltas`, esq, yRodape, { width: largura / 2, lineBreak: false })
        .text(`Página ${i + 1} de ${paginas.count}`, esq + largura / 2, yRodape, { width: largura / 2, align: 'right', lineBreak: false });
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
