import "dotenv/config"
import express from "express";
import cors from "cors";
import { MongoClient } from 'mongodb';

const app = express();
app.use(cors());
app.use(express.json());



const client = new MongoClient(process.env.DB_URL, {
  // useNewUrlParser: true,
  // useUnifiedTopology: true,
});

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

// Call this only when your application terminates
export async function disconnectFromMongoDB() {
  await client.close();
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db("equipment-rental-platform");


const usersCollection = db.collection("user");
// const equipmentCollection = db.collection("equipment");
// const bookingsCollection = db.collection("bookings");
// const reviewsCollection = db.collection("reviews");
// const paymentsCollection = db.collection("payments");
// const messagesCollection = db.collection("messages");
// const notificationsCollection = db.collection("notifications");
// const categoriesCollection = db.collection("categories");



app.get("/", (req, res) => {
  res.send("Hello from the Equipment Rental Platform server!");
});



app.get("/user", async (req, res) => {
  try {
    const user = await usersCollection.find().toArray();   
    res.json(user);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});





// app.get("/equipment", async (req, res) => {
//   try {
//     const equipment = await equipmentCollection.find().toArray(); 
//     res.json(equipment);
//   } catch (error) {
//     console.error("Error fetching equipment:", error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });

const port = process.env.PORT || 5001;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});