import { MongoClient } from "mongodb";
import { env } from "./env.js";

const client = new MongoClient(env.dbUrl);
let database;

export async function connectToDatabase() {
  await client.connect();
  database = client.db(env.dbName);
  await database.command({ ping: 1 });
  console.log(`MongoDB connected: ${env.dbName}`);
  return database;
}

export function getDatabase() {
  if (!database) throw new Error("MongoDB has not been connected yet.");
  return database;
}

export async function closeDatabase() {
  await client.close();
}
