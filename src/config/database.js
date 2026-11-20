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


export const db = await connectToDatabase();
export const usersCollection = db.collection("user");
export const equipmentCollection = db.collection("equipment");
export const bookingsCollection = db.collection("bookings");
// const reviewsCollection = db.collection("reviews");
// const paymentsCollection = db.collection("payments");
// const messagesCollection = db.collection("messages");
// const notificationsCollection = db.collection("notifications");
// const categoriesCollection = db.collection("categories"); 
// const transactionsCollection = db.collection("transactions");
// const rentalHistoryCollection = db.collection("rentalHistory");
// const maintenanceCollection = db.collection("maintenance");

export async function closeDatabase() {
  await client.close();
}
