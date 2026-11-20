import { Router } from "express";
import { getDatabase } from "../../config/database.js";

export const usersRouter = Router();

usersRouter.get("/", async (_req, res, next) => {
  try {
    const users = await getDatabase()
      .collection("user")
      .find({}, { projection: { name: 1, email: 1, role: 1, createdAt: 1 } })
      .toArray();

    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});
