// Migrações executadas no arranque (idempotentes: só aplicam o que ainda falta).
// Multi-escola: cada tabela de dados passa a ter escola_id; os dados existentes ficam na primeira escola.
const { pool } = require('./db');

const TABELAS_DA_ESCOLA = ['professores', 'turmas', 'disciplinas', 'horarios', 'faltas', 'utilizadores'];

async function colunaExiste(tabela, coluna) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [tabela, coluna]
  );
  return r.n > 0;
}

async function indiceExiste(tabela, indice) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [tabela, indice]
  );
  return r.n > 0;
}

// Troca um índice único global (ex: turmas.nome) por um único por escola (escola_id, nome)
async function unicoPorEscola(tabela, indiceAntigo, coluna) {
  const novo = `uq_${tabela}_escola_${coluna}`;
  if (await indiceExiste(tabela, novo)) return;
  await pool.query(`ALTER TABLE ${tabela} ADD UNIQUE KEY ${novo} (escola_id, ${coluna})`);
  if (await indiceExiste(tabela, indiceAntigo)) await pool.query(`ALTER TABLE ${tabela} DROP INDEX ${indiceAntigo}`);
}

// O site e o painel arrancam ao mesmo tempo: um bloqueio no MySQL garante que só um migra de cada vez
async function migrar() {
  const ligacao = await pool.getConnection();
  try {
    const [[{ ok }]] = await ligacao.query("SELECT GET_LOCK('gestao_escolar_migracoes', 60) AS ok");
    if (!ok) throw new Error('Não foi possível obter o bloqueio das migrações.');
    await aplicarMigracoes();
  } finally {
    await ligacao.query("SELECT RELEASE_LOCK('gestao_escolar_migracoes')").catch(() => {});
    ligacao.release();
  }
}

async function aplicarMigracoes() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS escolas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(150) NOT NULL,
      sigla VARCHAR(30),
      logo VARCHAR(255),
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM escolas');
  if (total === 0) {
    await pool.query(
      "INSERT INTO escolas (nome, sigla, logo) VALUES ('Escola Secundária Polivalente Cesaltina Ramos', 'E.S.P.C.R', '/img/logo.jpg')"
    );
    console.log('[migração] Escola inicial criada: Escola Secundária Polivalente Cesaltina Ramos');
  }
  const [[primeira]] = await pool.query('SELECT MIN(id) AS id FROM escolas');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS utilizadores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      escola_id INT NOT NULL,
      nome VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      palavra_passe VARCHAR(255) NOT NULL,
      perfil ENUM('admin','secretaria','continuo') NOT NULL DEFAULT 'secretaria',
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_utilizadores_escola (escola_id),
      CONSTRAINT fk_utilizadores_escola FOREIGN KEY (escola_id) REFERENCES escolas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // escola_id em cada tabela; os registos existentes ficam na primeira escola
  for (const tabela of TABELAS_DA_ESCOLA) {
    if (await colunaExiste(tabela, 'escola_id')) continue;
    await pool.query(
      `ALTER TABLE ${tabela}
         ADD COLUMN escola_id INT NOT NULL DEFAULT ${Number(primeira.id)} AFTER id,
         ADD INDEX idx_${tabela}_escola (escola_id),
         ADD CONSTRAINT fk_${tabela}_escola FOREIGN KEY (escola_id) REFERENCES escolas(id)`
    );
    // Sem valor por omissão: um INSERT sem escola_id falha em vez de ir parar à escola errada
    await pool.query(`ALTER TABLE ${tabela} ALTER COLUMN escola_id DROP DEFAULT`);
    console.log(`[migração] ${tabela}: escola_id adicionado`);
  }

  // Cor da escola (tema do site da escola); NULL = cor por omissão
  if (!(await colunaExiste('escolas', 'cor'))) {
    await pool.query('ALTER TABLE escolas ADD COLUMN cor VARCHAR(7) NULL AFTER logo');
    console.log('[migração] escolas: coluna cor adicionada');
  }

  await unicoPorEscola('turmas', 'nome', 'nome');
  await unicoPorEscola('disciplinas', 'nome', 'nome');
  await unicoPorEscola('professores', 'email', 'email');

  await pool.query(
    "ALTER TABLE utilizadores MODIFY perfil ENUM('admin','secretaria','continuo') NOT NULL DEFAULT 'secretaria'"
  );

  // Contas do painel da plataforma (dono do projeto), separadas dos utilizadores das escolas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plataforma_admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      palavra_passe VARCHAR(255) NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

module.exports = { migrar };
