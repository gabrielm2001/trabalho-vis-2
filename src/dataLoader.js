import { loadDb } from "./config.js";

let connection = null;

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

export async function getConnection() {
  if (!connection) {
    return await initializeDatabase();
  }
  return connection;
}

// Função auxiliar para executar queries
export async function executeQuery(sql) {
  try {
    const conn = await getConnection();
    const result = await conn.query(sql);
    const data = result.toArray().map(row => ({ ...row }))
    return data
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  }
}

// Função para obter informações sobre a tabela
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

// Função para obter contagem total de registros
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
