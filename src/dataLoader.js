// dataLoader.js — Inicialização do DuckDB-WASM e execução de queries SQL in-browser.
//
// DuckDB-WASM roda inteiramente no navegador via WebAssembly: não há servidor de banco,
// as queries são executadas no thread do browser (ou em um worker, dependendo da config).
// O arquivo Parquet é carregado via fetch e registrado no sistema de arquivos virtual do
// DuckDB com registerFileBuffer(), tornando-o acessível como se fosse um arquivo local.

import { loadDb } from "./config.js";

// Conexão singleton: reutilizada em todas as queries para evitar overhead
// de reconexão e para manter o estado da tabela "wfp" em memória.
let connection = null;

/**
 * Inicializa o banco de dados DuckDB-WASM e cria a tabela "wfp" a partir do Parquet.
 *
 * Fluxo:
 *   1. loadDb() → inicializa o worker WASM e retorna a instância do banco
 *   2. fetch() → baixa o Parquet (~80-150 MB) como ArrayBuffer
 *   3. registerFileBuffer() → expõe o buffer no FS virtual do DuckDB
 *   4. CREATE TABLE AS SELECT → materializa a tabela em memória para queries rápidas
 *
 * IF NOT EXISTS garante idempotência: chamadas repetidas não recria a tabela.
 */
export async function initializeDatabase() {
  try {
    const db = await loadDb();
    connection = await db.connect();

    const response = await fetch("./data/wfp_food_prices.parquet");
    const buffer = await response.arrayBuffer();

    await db.registerFileBuffer("wfp_food_prices.parquet", new Uint8Array(buffer));

    await connection.query(`
        CREATE TABLE IF NOT EXISTS wfp AS
        SELECT * FROM read_parquet('wfp_food_prices.parquet')
    `);

    console.log("Database initialized and wfp table created successfully");
    return connection;
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
}

/** Retorna a conexão existente ou inicializa o banco se ainda não foi feito. */
export async function getConnection() {
  if (!connection) {
    return await initializeDatabase();
  }
  return connection;
}

/**
 * Executa uma query SQL e retorna os resultados como array de objetos JS.
 *
 * result.toArray() retorna objetos Arrow — o spread {...row} os converte
 * em POJOs (plain objects) compatíveis com D3 e JSON.stringify.
 */
export async function executeQuery(sql) {
  try {
    const conn = await getConnection();
    const result = await conn.query(sql);
    const data = result.toArray().map(row => ({ ...row }));
    return data;
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  }
}

/** Retorna o schema da tabela wfp (nome e tipo de cada coluna). */
export async function getTableInfo() {
  try {
    const conn = await getConnection();
    const result = await conn.query("DESCRIBE wfp");
    return result.toArray();
  } catch (error) {
    console.error("Error getting table info:", error);
    throw error;
  }
}

/** Retorna o total de registros na tabela wfp. */
export async function getTotalRecords() {
  try {
    const conn = await getConnection();
    const result = await conn.query("SELECT COUNT(*) as total FROM wfp");
    return result.toArray()[0].total;
  } catch (error) {
    console.error("Error getting total records:", error);
    throw error;
  }
}
