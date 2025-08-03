const Database = require('better-sqlite3');
const db = new Database('mercado.db');


// Tabela de produtos 
db.exec(`
  CREATE TABLE IF NOT EXISTS produtos (
    codigo TEXT PRIMARY KEY,
    nome TEXT,
    preco REAL,
    estoque INTEGER,
    valorVenda REAL,
    lucro REAL
  );
`);

// Tabela de vendas
db.exec(`
  CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    total REAL NOT NULL
  );
`);

// Tabela de itens da venda
db.exec(`
  CREATE TABLE IF NOT EXISTS venda_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    codigo TEXT NOT NULL,
    quantidade INTEGER NOT NULL,
    valor REAL NOT NULL,
    subtotal REAL NOT NULL,
    lucro_unitario REAL NOT NULL,
    lucro_total REAL NOT NULL,
    FOREIGN KEY (venda_id) REFERENCES vendas (id)
  );
`);

// Tabela controle de vendas 
db.exec(`
  CREATE TABLE IF NOT EXISTS controle_vendas (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bloqueado INTEGER NOT NULL DEFAULT 0
  );

  -- Insere linha padrão se não existir
  INSERT OR IGNORE INTO controle_vendas (id, bloqueado) VALUES (1, 0);
`);
// Tabela de usuario 
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    senha TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('operador', 'admin'))
  );
`);


module.exports = db;


