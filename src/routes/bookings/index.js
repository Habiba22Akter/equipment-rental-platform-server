import { Router } from "express";
import { getDatabase } from "../../config/database.js";

export const bookingsRouter = Router();

bookingsRouter.get("/", async (_req, res, next) => {
  try {
    const bookings = await getDatabase().collection("bookings").find({}).toArray();
    res.json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
});
