const db = require('./db');

// Apaga a tabela
db.exec(`DROP TABLE IF EXISTS produtos;`);

console.log("Tabela 'produtos' apagada com sucesso!");
