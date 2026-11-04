const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { diasUteisMes } = require('../config/ui');
const { labelDia } = require('../config/horarioSlots');
const { aulasAgora, calcularProgresso } = require('../config/aulas');

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Dados fictícios para pré-visualizar a lista "Professores com aula agora" fora do horário letivo.
// Usa os professores ativos reais (com a sua disciplina e turma) e inventa aulas a decorrer agora.
async function aulasDemo(escolaId, agora) {
  const [profs] = await pool.query(
    `SELECT p.id AS professor_id, p.nome AS professor_nome,
      (SELECT d.nome FROM professor_disciplinas pd JOIN disciplinas d ON d.id = pd.disciplina_id
         WHERE pd.professor_id = p.id ORDER BY d.nome LIMIT 1) AS disciplina_nome,
      (SELECT t.nome FROM professor_turmas pt JOIN turmas t ON t.id = pt.turma_id
         WHERE pt.professor_id = p.id ORDER BY t.nome LIMIT 1) AS turma_nome
     FROM professores p WHERE p.escola_id = ? AND p.ativo = 1 ORDER BY p.nome LIMIT 8`,
    [escolaId]
  );

  const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();

  return profs.map((p, i) => {
    const decorridos = 5 + ((i * 13) % 35); // cada aula começou há 5–40 minutos
    const duracao = i % 3 === 0 ? 90 : 45;
    const inicio = Math.max(0, agoraMin - decorridos);
    return {
      ...p,
      disciplina_nome: p.disciplina_nome || 'Matemática',
      turma_nome: p.turma_nome || '10ºA',
      sala: `Sala ${String(3 + i * 2).padStart(2, '0')}`,
      hora_inicio: hhmm(inicio),
      hora_fim: hhmm(Math.min(Math.max(inicio + duracao, agoraMin + 1), 23 * 60 + 59)),
      tem_falta: i === 2 || i === 5 ? 1 : 0
    };
  });
}

router.get('/', async (req, res, next) => {
  try {
    const escolaId = req.escolaId;
    const [[{ totalProfessores }]] = await pool.query(
      'SELECT COUNT(*) AS totalProfessores FROM professores WHERE escola_id = ? AND ativo = 1', [escolaId]
    );

    const [[{ totalFaltasMes }]] = await pool.query(
      `SELECT COUNT(*) AS totalFaltasMes FROM faltas
       WHERE escola_id = ? AND MONTH(data_falta) = MONTH(CURDATE()) AND YEAR(data_falta) = YEAR(CURDATE())`,
      [escolaId]
    );

    const [faltasRecentes] = await pool.query(
      `SELECT f.id, f.data_falta, f.motivo, f.tipo, f.justificada, p.id AS professor_id, p.nome AS professor_nome
       FROM faltas f
       JOIN professores p ON p.id = f.professor_id
       WHERE f.escola_id = ?
       ORDER BY f.data_falta DESC, f.id DESC
       LIMIT 5`,
      [escolaId]
    );

    const [porMes] = await pool.query(
      `SELECT MONTH(data_falta) AS mes, COUNT(*) AS total
       FROM faltas
       WHERE escola_id = ? AND YEAR(data_falta) = YEAR(CURDATE())
       GROUP BY mes`,
      [escolaId]
    );

    // Janeiro até ao mês atual, com zeros nos meses sem faltas
    const mesAtual = new Date().getMonth() + 1;
    const faltasPorMes = MESES_CURTOS.slice(0, mesAtual).map((label, i) => {
      const linha = porMes.find((r) => Number(r.mes) === i + 1);
      return { mes: label, total: linha ? Number(linha.total) : 0 };
    });

    // Assiduidade do mês: 1 - faltas / (professores ativos × dias úteis do mês)
    const diasPossiveis = totalProfessores * diasUteisMes();
    const taxaAssiduidade = diasPossiveis
      ? Math.max(0, (1 - totalFaltasMes / diasPossiveis) * 100).toFixed(1)
      : '100.0';

    // Professores com aula a decorrer neste momento, segundo o horário
    const agora = new Date();
    const atual = await aulasAgora(escolaId, agora);
    const diaAtualKey = atual.diaKey;
    const horaAtual = atual.hora;
    let { aulas, proximaAula } = atual;

    // Pré-visualização com dados fictícios (/?demo=1): nada é gravado na base de dados
    const demo = req.query.demo === '1';
    if (demo) {
      aulas = await aulasDemo(escolaId, agora);
      proximaAula = null;
    }

    calcularProgresso(aulas, agora);

    res.render('dashboard', {
      pageTitle: 'Dashboard',
      activePage: 'dashboard',
      stats: { totalProfessores, totalFaltasMes, taxaAssiduidade },
      faltasRecentes,
      faltasPorMes,
      aulasAgora: aulas,
      proximaAula,
      momentoAtual: diaAtualKey || demo
        ? `${labelDia(diaAtualKey || 'segunda')}, ${horaAtual.slice(0, 5)}`
        : 'Fim de semana — sem aulas',
      demo,
      success: req.query.success
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
