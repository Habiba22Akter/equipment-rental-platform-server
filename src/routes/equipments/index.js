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

equipmentsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const required = ["name", "description", "category", "location", "imageUrl", "ownerId"];

    for (const field of required) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        return res.status(400).json({
          success: false,
          error: { message: `${field} is required` },
        });
      }
    }

    const dailyRate = Number(body.dailyRate);
    const availableQuantity = Number(body.availableQuantity);
    if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
      return res.status(400).json({
        success: false,
        error: { message: "dailyRate must be greater than zero" },
      });
    }
    if (!Number.isInteger(availableQuantity) || availableQuantity < 1) {
      return res.status(400).json({
        success: false,
        error: { message: "availableQuantity must be at least one" },
      });
    }

    const rentalType = ["Daily", "Weekly", "Monthly"].includes(body.rentalType)
      ? body.rentalType
      : "Daily";
    const now = new Date();
    const result = await getDatabase().collection("equipment").insertOne({
      name: body.name.trim(),
      description: body.description.trim(),
      category: body.category.trim(),
      location: body.location.trim(),
      imageUrl: body.imageUrl.trim(),
      dailyRate,
      weeklyRate: Number(body.weeklyRate) || dailyRate * 7,
      monthlyRate: Number(body.monthlyRate) || dailyRate * 30,
      rentalType,
      availableQuantity,
      quantity: availableQuantity,
      terms: typeof body.terms === "string" && body.terms.trim()
        ? body.terms.trim()
        : "Return the equipment clean and on time. The renter is responsible for accidental damage during the rental period.",
      ownerId: body.ownerId,
      ownerName: typeof body.ownerName === "string" ? body.ownerName : "Verified owner",
      ownerEmail: typeof body.ownerEmail === "string" ? body.ownerEmail : "",
      status: "pending",
      approvalStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({
      success: true,
      data: { _id: result.insertedId },
    });
  } catch (error) {
    next(error);
  }
});
