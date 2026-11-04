const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gestao_escolar',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

// O MySQL corre em UTC: cada ligação passa a usar o fuso horário da aplicação (variável TZ),
// para que CURDATE()/NOW() coincidam com a hora local da escola.
function offsetLocal() {
  const minutos = -new Date().getTimezoneOffset();
  const sinal = minutos >= 0 ? '+' : '-';
  const abs = Math.abs(minutos);
  return `${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

pool.on('connection', (connection) => {
  connection.query(`SET time_zone = '${offsetLocal()}'`);
});

// Espera até a base de dados estar pronta para aceitar ligações.
// Útil no arranque com docker-compose, onde o container do MySQL
// pode demorar alguns segundos a inicializar.
async function waitForDatabase(retries = 20, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const connection = await pool.getConnection();
      connection.release();
      console.log('Ligação à base de dados MySQL estabelecida.');
      return;
    } catch (err) {
      console.log(`A aguardar pela base de dados... (tentativa ${attempt}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Não foi possível ligar à base de dados MySQL.');
}

module.exports = { pool, waitForDatabase };
