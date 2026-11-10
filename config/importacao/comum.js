// Utilidades partilhadas pela importação de professores e de horários
const { pool } = require('../db');
const { partesTurma, nomeTurma } = require('../ui');

const MAX_LINHAS = 2000;
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Chave de comparação: sem acentos, minúsculas e espaços simples ("Matemática " == "matematica")
const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const limpo = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// "Matemática, Física / Química" -> ['Matemática', 'Física', 'Química']
const lista = (s) => String(s ?? '').split(/[,;/\n]/).map(limpo).filter(Boolean);

// Dados atuais da escola, para comparar com o ficheiro
async function catalogoEscola(escolaId) {
  const [disciplinas] = await pool.query('SELECT id, nome FROM disciplinas WHERE escola_id = ?', [escolaId]);
  const [turmas] = await pool.query('SELECT id, nome FROM turmas WHERE escola_id = ?', [escolaId]);
  const [professores] = await pool.query('SELECT id, nome, email, telefone FROM professores WHERE escola_id = ?', [escolaId]);
  const [ligDisciplinas] = await pool.query(
    'SELECT pd.professor_id, pd.disciplina_id FROM professor_disciplinas pd JOIN professores p ON p.id = pd.professor_id WHERE p.escola_id = ?', [escolaId]
  );
  const [ligTurmas] = await pool.query(
    'SELECT pt.professor_id, pt.turma_id FROM professor_turmas pt JOIN professores p ON p.id = pt.professor_id WHERE p.escola_id = ?', [escolaId]
  );
  const [horarios] = await pool.query(
    `SELECT h.id, h.turma_id, h.professor_id, h.disciplina_id, h.dia_semana, h.hora_inicio, h.hora_fim, h.sala,
       t.nome AS turma_nome, p.nome AS professor_nome, d.nome AS disciplina_nome
     FROM horarios h
     JOIN turmas t ON t.id = h.turma_id
     JOIN professores p ON p.id = h.professor_id
     JOIN disciplinas d ON d.id = h.disciplina_id
     WHERE h.escola_id = ?`, [escolaId]
  );
  return { disciplinas, turmas, professores, ligDisciplinas, ligTurmas, horarios };
}

// Resolve nomes de disciplinas e turmas para as existentes, ou marca-as como novas (se permitido)
function criarResolvedores(cat, { criarEmFalta }) {
  const disciplinas = new Map(cat.disciplinas.map((d) => [chave(d.nome), d]));
  const turmas = new Map(cat.turmas.map((t) => [chave(t.nome), t]));

  function disciplina(nome, erros) {
    const existente = disciplinas.get(chave(nome));
    if (existente) return { id: existente.id, nome: existente.nome };
    if (criarEmFalta) return { nova: true, nome: limpo(nome) };
    erros.push(`A disciplina "${limpo(nome)}" não existe.`);
    return null;
  }

  function turma(texto, erros) {
    const original = limpo(texto);
    const direta = turmas.get(chave(original));
    if (direta) return { id: direta.id, nome: direta.nome };

    // "10A", "10 A", "10.º A" -> "10ºA"; "10 ASIBD1" -> "10º ASIBD1"
    const { ano, letra } = partesTurma(original.replace(/\.º|º\.|ª/g, 'º'));
    if (!ano) {
      erros.push(`Turma "${original}" inválida: use o ano e a turma, por exemplo 10ºA ou 10º ASIBD1.`);
      return null;
    }
    const nome = nomeTurma(ano, letra);
    const existente = turmas.get(chave(nome));
    if (existente) return { id: existente.id, nome: existente.nome };
    if (criarEmFalta) return { nova: true, nome };
    erros.push(`A turma "${nome}" não existe.`);
    return null;
  }

  return { disciplina, turma };
}

// Cria (uma só vez por nome) as disciplinas/turmas novas, dentro da transação
function criarGarantidores(conn, escolaId, contagem) {
  const criadas = { disciplina: new Map(), turma: new Map() };

  async function garantir(tipo, ref) {
    if (ref.id) return ref.id;
    const k = chave(ref.nome);
    if (!criadas[tipo].has(k)) {
      const [r] = tipo === 'disciplina'
        ? await conn.query('INSERT INTO disciplinas (escola_id, nome) VALUES (?, ?)', [escolaId, ref.nome])
        : await conn.query("INSERT INTO turmas (escola_id, nome, ano_letivo) VALUES (?, ?, '2025/2026')", [escolaId, ref.nome]);
      criadas[tipo].set(k, r.insertId);
      contagem[tipo === 'disciplina' ? 'disciplinasCriadas' : 'turmasCriadas']++;
    }
    return criadas[tipo].get(k);
  }

  return {
    disciplina: (ref) => garantir('disciplina', ref),
    turma: (ref) => garantir('turma', ref)
  };
}

// Corre uma função dentro de uma transação: ou grava tudo, ou nada
async function emTransacao(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Totais para o resumo da pré-visualização
function contarEstados(linhas) {
  const c = { novo: 0, atualizar: 0, ignorada: 0, erro: 0 };
  linhas.forEach((l) => { c[l.estado] = (c[l.estado] || 0) + 1; });
  c.validas = c.novo + c.atualizar;
  return c;
}

module.exports = {
  MAX_LINHAS, EMAIL_VALIDO, chave, limpo, lista,
  catalogoEscola, criarResolvedores, criarGarantidores, emTransacao, contarEstados
};
