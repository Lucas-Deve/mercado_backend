const express = require('express');
const app = express();
const cors = require('cors');
const db = require('./db');

// Configurações do Express
app.use(cors());
app.use(express.json());

// Rotas GET //
// Rota principal para testar se está rodando
// Rota que lista todos os produtos - deve vir primeiro
app.get('/produtos', (req, res) => {
  const produtos = db.prepare('SELECT * FROM produtos').all();
  res.json(produtos);
});

// Rota que busca um produto pelo código - deve vir depois
app.get('/produtos/:codigo', (req, res) => {
  const codigo = req.params.codigo;

  const produto = db.prepare('SELECT * FROM produtos WHERE codigo = ?').get(codigo);

  if (!produto) {
    return res.status(404).json({ mensagem: 'Produto não encontrado' });
  }

  res.json(produto);
});
app.get('/produtos', (req, res) => {
  const { codigos } = req.query;

  if (codigos) {
    const lista = codigos.split(",").map(c => c.trim());
    const placeholders = lista.map(() => '?').join(',');
    const produtos = db.prepare(`SELECT * FROM produtos WHERE codigo IN (${placeholders})`).all(...lista);
    return res.json(produtos);
  }

  // Busca geral
  const produtos = db.prepare('SELECT * FROM produtos').all();
  res.json(produtos);
});

app.get('/vendas', (req, res) => {
  const { inicio, fim } = req.query;

  try {
    let vendas;

    if (inicio && fim) {
      // Filtra vendas entre inicio e fim (inclusive)
      vendas = db.prepare(`
        SELECT * FROM vendas WHERE data BETWEEN ? AND ? ORDER BY data ASC
      `).all(inicio, fim);
    } else {
      // Se não informar período, retorna vendas do dia atual
      const dataAtual = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
      vendas = db.prepare('SELECT * FROM vendas WHERE data = ?').all(dataAtual);
    }

    const vendasComItens = vendas.map((venda) => {
      const itens = db.prepare('SELECT codigo, quantidade, valor, subtotal FROM venda_itens WHERE venda_id = ?').all(venda.id);
      return { ...venda, itens };
    });

    res.json(vendasComItens);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ mensagem: 'Erro ao buscar vendas' });
  }
});
app.get('/lucro-vendas', (req, res) => {
  const { inicio, fim } = req.query;

  try {
    let query = `
      SELECT 
        COALESCE(SUM(v.total), 0) AS totalVendas,
        COALESCE(SUM(vi.lucro_total), 0) AS totalLucro
      FROM vendas v
      JOIN venda_itens vi ON v.id = vi.venda_id
    `;

    const params = [];
    if (inicio && fim) {
      query += ' WHERE v.data BETWEEN ? AND ?';
      params.push(inicio, fim);
    }

    const resultado = db.prepare(query).get(...params);

    res.json({
      totalVendas: resultado.totalVendas,
      totalLucro: resultado.totalLucro,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensagem: 'Erro ao buscar lucro das vendas' });
  }
});

app.get('/total-estoque', (req, res) => {
  try {
    const result = db.prepare(`
      SELECT SUM(estoque * valorVenda) AS totalEstoque
      FROM produtos
    `).get();
    res.json({ totalEstoque: result.totalEstoque || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensagem: 'Erro ao buscar total de estoque' });
  }
});

// Rota para listar todos os usuários (sem a senha)
app.get('/usuarios', (req, res) => {
  try {
    const usuarios = db.prepare('SELECT id, nome, tipo FROM usuarios').all();
    res.json(usuarios);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensagem: 'Erro ao listar usuários' });
  }
});

//Fim das Rotas Get///

// Rota POST //
app.post('/produtos', (req, res) => {
  const { codigo, nome, preco, estoque, valorVenda, lucro } = req.body;

  if (!codigo || !nome || preco == null || estoque == null || valorVenda == null || lucro == null) {
    return res.status(400).json({ mensagem: 'Campos obrigatórios não enviados' });
  }

  // 👉 Verifica se o código já existe
  const produtoExistente = db.prepare('SELECT * FROM produtos WHERE codigo = ?').get(codigo);

  if (produtoExistente) {
    return res.status(400).json({ mensagem: 'Já existe um produto com esse código.' });
  }

  try {
    const stmt = db.prepare('INSERT INTO produtos (codigo, nome, preco, estoque, valorVenda, lucro) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(codigo, nome, preco, estoque, valorVenda, lucro);

    res.status(201).json({ mensagem: 'Produto adicionado com sucesso!', codigo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensagem: 'Erro ao adicionar produto' });
  }
});


app.post('/conferir-inventario', (req, res) => {
  const { produtos } = req.body;

  const diferencas = produtos.map(({ codigo, quantidadeFisica }) => {
    const produto = db.prepare('SELECT nome, estoque, preco, valorVenda, lucro FROM produtos WHERE codigo = ?').get(codigo);

    const estoqueAtual = produto?.estoque || 0;
    const estoqueFisico = quantidadeFisica || 0;
    const diferenca = estoqueFisico - estoqueAtual;

    return {
      codigo,
      nome: produto?.nome || "Não encontrado",
      estoqueAtual,
      estoqueFisico,
      diferenca,
      preco: produto?.preco || 0,
      valorVenda: produto?.valorVenda || 0,
      lucro: produto?.lucro || 0
    };
  });

  res.json(diferencas);
});

app.post('/ajustar-inventario', (req, res) => {
  const { produtos } = req.body;

  try {
    produtos.forEach(({ codigo, estoqueFisico }) => {
      db.prepare('UPDATE produtos SET estoque = ? WHERE codigo = ?').run(estoqueFisico, codigo);
    });

    res.json({ mensagem: 'Inventário ajustado com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensagem: 'Erro ao ajustar inventário' });
  }
});
app.post('/ajustar-estoque', (req, res) => {
  const { itens } = req.body;

  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ mensagem: 'Itens inválidos ou vazios' });
  }

  const dbTransaction = db.transaction((items) => {
    for (const item of items) {
      const produto = db.prepare('SELECT estoque FROM produtos WHERE codigo = ?').get(item.codigo);

      if (!produto) {
        throw new Error(`Produto com código ${item.codigo} não encontrado`);
      }

      if (produto.estoque < item.quantidade) {
        throw new Error(`Estoque insuficiente para o produto ${item.codigo}`);
      }

      db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE codigo = ?').run(item.quantidade, item.codigo);
    }
  });

  try {
    dbTransaction(itens);
    res.json({ mensagem: 'Estoque atualizado com sucesso' });
  } catch (error) {
    console.error(error.message);
    res.status(400).json({ mensagem: error.message });
  }
});

app.post('/vendas', (req, res) => {
  const { itens, total } = req.body;
  console.log("Recebido no POST /vendas:", req.body);

  if (!Array.isArray(itens) || itens.length === 0 || total == null) {
    return res.status(400).json({ mensagem: 'Dados da venda inválidos' });
  }

  const dataAtual = new Date().toISOString().split('T')[0]; // yyyy-mm-dd

  const dbTransaction = db.transaction(() => {
    // Salva a venda
    const vendaStmt = db.prepare('INSERT INTO vendas (data, total) VALUES (?, ?)');
    const vendaResult = vendaStmt.run(dataAtual, total);
    const vendaId = vendaResult.lastInsertRowid;

    // Salva os itens
    const itemStmt = db.prepare(`
      INSERT INTO venda_itens (venda_id, codigo, quantidade, valor, subtotal, lucro_unitario, lucro_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    itens.forEach((item) => {
      const lucroTotal = item.lucro * item.quantidade;
      itemStmt.run(
        vendaId,
        item.codigo,
        item.quantidade,
        item.valor,
        item.subtotal,
        item.lucro,
        lucroTotal
      );
    });
  });

  try {
    dbTransaction();
    res.json({ mensagem: 'Venda registrada com sucesso' });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ mensagem: 'Erro ao registrar venda' });
  }
});

// Atualiza o status de bloqueio
app.post('/bloquear-vendas', (req, res) => {
  const { bloqueado } = req.body;
  if (typeof bloqueado !== 'boolean') {
    return res.status(400).json({ mensagem: 'Campo bloqueado inválido' });
  }
  db.prepare('UPDATE controle_vendas SET bloqueado = ? WHERE id = 1').run(bloqueado ? 1 : 0);
  res.json({ mensagem: `Vendas ${bloqueado ? 'bloqueadas' : 'liberadas'} com sucesso!` });
});

app.post('/usuarios', (req, res) => {
  const { nome, senha, tipo } = req.body;

  if (!nome || !senha || !tipo) {
    return res.status(400).json({ mensagem: 'Preencha todos os campos' });
  }

  // Verifica se o usuário já existe
  const usuarioExistente = db.prepare('SELECT * FROM usuarios WHERE nome = ?').get(nome);
  if (usuarioExistente) {
    return res.status(400).json({ mensagem: 'Usuário já existe' });
  }

  try {
    db.prepare('INSERT INTO usuarios (nome, senha, tipo) VALUES (?, ?, ?)').run(nome, senha, tipo);
    res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensagem: 'Erro ao cadastrar usuário' });
  }
});

//Verificação de login// 
app.post('/login', (req, res) => {
  const { nome, senha } = req.body;

  if (!nome || !senha) {
    return res.status(400).json({ mensagem: 'Preencha nome e senha' });
  }

  const usuario = db.prepare('SELECT * FROM usuarios WHERE nome = ? AND senha = ?').get(nome, senha);

  if (!usuario) {
    return res.status(401).json({ mensagem: 'Usuário ou senha inválidos' });
  }

  res.json({ mensagem: 'Login bem-sucedido', tipo: usuario.tipo });
});


// Fim da Rota Post //

// Inicio da Rota PUT //
app.put('/produtos/:codigo', (req, res) => {
  const codigo = req.params.codigo;
  const { nome, preco, estoque } = req.body;

  const produto = db.prepare('SELECT * FROM produtos WHERE codigo = ?').get(codigo);
  if (!produto) {
    return res.status(404).json({ mensagem: 'Produto não encontrado' });
  }

  db.prepare('UPDATE produtos SET nome = ?, preco = ?, estoque = ? WHERE codigo = ?')
    .run(nome || produto.nome, preco ?? produto.preco, estoque ?? produto.estoque, codigo);

  res.json({ mensagem: 'Produto atualizado com sucesso!' });
});

app.delete('/produtos/:codigo', (req, res) => {
  const codigo = req.params.codigo;

  const info = db.prepare('DELETE FROM produtos WHERE codigo = ?').run(codigo);

  if (info.changes === 0) {
    return res.status(404).json({ mensagem: 'Produto não encontrado' });
  }

  res.json({ mensagem: 'Produto excluído com sucesso!' });
});

// Inicializa servidor
app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});
// Final da Rota PUT//

//Rota delete// 
// Rota para excluir usuário pelo id
app.delete('/usuarios/:id', (req, res) => {
  const { id } = req.params;

  try {
    const info = db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    if (info.changes === 0) {
      return res.status(404).json({ mensagem: 'Usuário não encontrado' });
    }
    res.json({ mensagem: 'Usuário excluído com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensagem: 'Erro ao excluir usuário' });
  }
});

// Fim da rota Delete//


