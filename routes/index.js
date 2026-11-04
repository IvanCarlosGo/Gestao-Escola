const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { diasUteisMes } = require('../config/ui');
const { DIA_SEMANA_JS, labelDia } = require('../config/horarioSlots');

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Dados fictícios para pré-visualizar a lista "Professores com aula agora" fora do horário letivo.
// Usa os professores ativos reais (com a sua disciplina e turma) e inventa aulas a decorrer agora.
async function aulasDemo(agora) {
  const [profs] = await pool.query(
    `SELECT p.id AS professor_id, p.nome AS professor_nome,
      (SELECT d.nome FROM professor_disciplinas pd JOIN disciplinas d ON d.id = pd.disciplina_id
         WHERE pd.professor_id = p.id ORDER BY d.nome LIMIT 1) AS disciplina_nome,
      (SELECT t.nome FROM professor_turmas pt JOIN turmas t ON t.id = pt.turma_id
         WHERE pt.professor_id = p.id ORDER BY t.nome LIMIT 1) AS turma_nome
     FROM professores p WHERE p.ativo = 1 ORDER BY p.nome LIMIT 8`
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
    const [[{ totalProfessores }]] = await pool.query(
      'SELECT COUNT(*) AS totalProfessores FROM professores WHERE ativo = 1'
    );

    const [[{ totalFaltasMes }]] = await pool.query(
      `SELECT COUNT(*) AS totalFaltasMes FROM faltas
       WHERE MONTH(data_falta) = MONTH(CURDATE()) AND YEAR(data_falta) = YEAR(CURDATE())`
    );

    const [faltasRecentes] = await pool.query(
      `SELECT f.id, f.data_falta, f.motivo, f.tipo, f.justificada, p.id AS professor_id, p.nome AS professor_nome
       FROM faltas f
       JOIN professores p ON p.id = f.professor_id
       ORDER BY f.data_falta DESC, f.id DESC
       LIMIT 5`
    );

    const [porMes] = await pool.query(
      `SELECT MONTH(data_falta) AS mes, COUNT(*) AS total
       FROM faltas
       WHERE YEAR(data_falta) = YEAR(CURDATE())
       GROUP BY mes`
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
    const hoje = agora.toLocaleDateString('sv-SE');
    const diaAtualKey = DIA_SEMANA_JS[agora.getDay()] || null;
    const horaAtual = agora.toTimeString().slice(0, 8);

    let aulasAgora = [];
    let proximaAula = null;

    if (diaAtualKey) {
      [aulasAgora] = await pool.query(
        `SELECT h.hora_inicio, h.hora_fim, h.sala,
          p.id AS professor_id, p.nome AS professor_nome,
          d.nome AS disciplina_nome, t.nome AS turma_nome,
          EXISTS(SELECT 1 FROM faltas f WHERE f.professor_id = p.id AND f.data_falta = ?) AS tem_falta
         FROM horarios h
         JOIN professores p ON p.id = h.professor_id AND p.ativo = 1
         JOIN disciplinas d ON d.id = h.disciplina_id
         JOIN turmas t ON t.id = h.turma_id
         WHERE h.dia_semana = ? AND h.hora_inicio <= ? AND h.hora_fim > ?
         ORDER BY p.nome ASC`,
        [hoje, diaAtualKey, horaAtual, horaAtual]
      );

      if (aulasAgora.length === 0) {
        [[proximaAula]] = await pool.query(
          `SELECT MIN(h.hora_inicio) AS hora_inicio
           FROM horarios h JOIN professores p ON p.id = h.professor_id AND p.ativo = 1
           WHERE h.dia_semana = ? AND h.hora_inicio > ?`,
          [diaAtualKey, horaAtual]
        );
        if (!proximaAula || !proximaAula.hora_inicio) proximaAula = null;
      }
    }

    // Pré-visualização com dados fictícios (/?demo=1): nada é gravado na base de dados
    const demo = req.query.demo === '1';
    if (demo) {
      aulasAgora = await aulasDemo(agora);
      proximaAula = null;
    }

    // Progresso de cada aula: minutos que faltam e % já decorrida
    const minutos = (hora) => {
      const [h, m] = String(hora).split(':').map(Number);
      return h * 60 + m;
    };
    const agoraMin = agora.getHours() * 60 + agora.getMinutes();
    aulasAgora.forEach((a) => {
      const inicio = minutos(a.hora_inicio);
      const fim = minutos(a.hora_fim);
      a.minutosRestantes = Math.max(0, fim - agoraMin);
      a.progresso = Math.min(100, Math.max(0, Math.round(((agoraMin - inicio) / (fim - inicio)) * 100)));
    });

    res.render('dashboard', {
      pageTitle: 'Dashboard',
      activePage: 'dashboard',
      stats: { totalProfessores, totalFaltasMes, taxaAssiduidade },
      faltasRecentes,
      faltasPorMes,
      aulasAgora,
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
