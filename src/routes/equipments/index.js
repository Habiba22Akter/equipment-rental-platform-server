import { Router } from "express";
import { getDatabase } from "../../config/database.js";

export const equipmentsRouter = Router();

equipmentsRouter.get("/", async (_req, res, next) => {
  try {
    const equipments = await getDatabase().collection("equipment").find({}).toArray();
    res.json({ success: true, data: equipments });
  } catch (error) {
    next(error);
  }
});
