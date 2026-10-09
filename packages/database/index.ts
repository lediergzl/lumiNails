import { Capacitor } from "@capacitor/core";
import { SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { LOCAL_DB_VERSION, LOCAL_SCHEMA_SQL } from "./schema";

export * from "./schema";

const DATABASE_NAME = "luni_local";
let connection: SQLiteDBConnection | null = null;
let opening: Promise<SQLiteDBConnection> | null = null;

/**
 * Opens the native SQLite database and applies idempotent schema creation.
 * Call only after Capacitor has initialized. No data is downloaded by this module.
 */
export async function openLocalDatabase(): Promise<SQLiteDBConnection> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("SQLite nativo solo está disponible dentro de la APK. El preview web aún no tiene adaptador local.");
  }
  if (connection) return connection;
  if (opening) return opening;

  opening = (async () => {
    const sqlite = new SQLiteConnection((await import("@capacitor-community/sqlite")).CapacitorSQLite);
    const consistency = await sqlite.checkConnectionsConsistency();
    const isConn = await sqlite.isConnection(DATABASE_NAME, false);
    const db = consistency.result && isConn.result
      ? await sqlite.retrieveConnection(DATABASE_NAME, false)
      : await sqlite.createConnection(DATABASE_NAME, false, "no-encryption", LOCAL_DB_VERSION, false);

    await db.open();
    for (const statement of LOCAL_SCHEMA_SQL) {
      await db.execute(statement);
    }
    await db.execute(`PRAGMA user_version = ${LOCAL_DB_VERSION}`);
    connection = db;
    return db;
  })();

  try {
    return await opening;
  } catch (error) {
    opening = null;
    throw error;
  }
}

export async function closeLocalDatabase(): Promise<void> {
  if (!connection) return;
  await connection.close();
  connection = null;
  opening = null;
}

export * from "./repository";
