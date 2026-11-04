// Seeder do administrador do painel da plataforma.
//
// Corre sozinho no arranque do painel e também à mão:
//   npm run seed:admin            -> cria a conta se ainda não existir
//   npm run seed:admin -- --repor -> repõe a palavra-passe por omissão (se a esqueceu)
//
// Se a conta já existir, a palavra-passe NÃO é alterada (a não ser com --repor),
// para que uma palavra-passe mudada no painel não volte atrás a cada arranque.
const { pool } = require('../config/db');
const { hashPalavraPasse } = require('../config/auth');

const ADMIN_PADRAO = {
  nome: 'Admin',
  email: 'admin@admin.cv',
  palavraPasse: 'Welcome$1999$'
};

async function seedAdmin({ repor = false } = {}) {
  const nome = process.env.PAINEL_NOME || ADMIN_PADRAO.nome;
  const email = (process.env.PAINEL_EMAIL || ADMIN_PADRAO.email).trim().toLowerCase();
  const palavraPasse = process.env.PAINEL_PASSWORD || ADMIN_PADRAO.palavraPasse;

  const [[existente]] = await pool.query('SELECT id FROM plataforma_admins WHERE email = ?', [email]);

  if (!existente) {
    await pool.query(
      'INSERT INTO plataforma_admins (nome, email, palavra_passe) VALUES (?, ?, ?)',
      [nome, email, hashPalavraPasse(palavraPasse)]
    );
    console.log(`[seeder] Administrador do painel criado: ${email}`);
  } else if (repor) {
    await pool.query(
      'UPDATE plataforma_admins SET nome = ?, palavra_passe = ?, ativo = 1 WHERE id = ?',
      [nome, hashPalavraPasse(palavraPasse), existente.id]
    );
    console.log(`[seeder] Palavra-passe do administrador ${email} reposta.`);
  }
}

module.exports = { seedAdmin };

// Execução direta: node painel/seeder.js [--repor]
if (require.main === module) {
  require('dotenv').config();
  const { waitForDatabase } = require('../config/db');
  const { migrar } = require('../config/migracoes');
  (async () => {
    try {
      await waitForDatabase();
      await migrar();
      await seedAdmin({ repor: process.argv.includes('--repor') });
      process.exit(0);
    } catch (err) {
      console.error('[seeder] Falhou:', err.message);
      process.exit(1);
    }
  })();
}
