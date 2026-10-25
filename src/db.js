
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("Falta configurar MONGODB_URI");
}

const client = new MongoClient(uri);

let connection;

export async function getDb() {
  if (!connection) {
    connection = client.connect().catch((error) => {
      connection = undefined;
      throw error;
    });
  }

  const connectedClient = await connection;
  return connectedClient.db(
    process.env.MONGODB_DB || "aeogen"
  );
}
