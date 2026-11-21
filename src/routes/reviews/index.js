import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../../config/database.js";

export const reviewsRouter = Router();

function reviewsCollection() {
  return getDatabase().collection("reviews");
}

function actor(req) {
  return {
    id: req.get("x-user-id") ?? "",
    role: req.get("x-user-role") ?? "",
  };
}

function objectId(value) {
  return typeof value === "string" && ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

reviewsRouter.get("/", async (req, res, next) => {
  try {
    const filter = {};

    if (typeof req.query.equipmentId === "string" && req.query.equipmentId.trim()) {
      filter.equipmentId = req.query.equipmentId.trim();
    }
    if (typeof req.query.ownerId === "string" && req.query.ownerId.trim()) {
      filter.ownerId = req.query.ownerId.trim();
    }
    if (typeof req.query.customerId === "string" && req.query.customerId.trim()) {
      filter.customerId = req.query.customerId.trim();
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const reviews = await reviewsCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    res.json({ success: true, data: reviews });
  } catch (error) {
    next(error);
  }
});

reviewsRouter.post("/", async (req, res, next) => {
  try {
    const user = actor(req);
    if (!user.id) {
      return res.status(401).json({ success: false, error: { message: "Sign in to leave a review" } });
    }

    const body = req.body ?? {};
    const bookingId = objectId(body.bookingId);
    if (!bookingId) {
      return res.status(400).json({ success: false, error: { message: "A valid booking is required" } });
    }

    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: { message: "rating must be between 1 and 5" } });
    }

    const comment = text(body.comment);
    if (comment.length > 600) {
      return res.status(400).json({ success: false, error: { message: "comment must be 600 characters or fewer" } });
    }

    const booking = await getDatabase().collection("bookings").findOne({ _id: bookingId });
    if (!booking) {
      return res.status(404).json({ success: false, error: { message: "Booking not found" } });
    }
    if (booking.customerId !== user.id) {
      return res.status(403).json({ success: false, error: { message: "You can only review your own rentals" } });
    }
    if (booking.status !== "completed") {
      return res.status(400).json({
        success: false,
        error: { message: "You can review a rental once it is completed" },
      });
    }

    const existing = await reviewsCollection().findOne({ bookingId: bookingId.toString() });
    if (existing) {
      return res.status(409).json({ success: false, error: { message: "This rental has already been reviewed" } });
    }

    const equipment = objectId(booking.equipmentId)
      ? await getDatabase().collection("equipment").findOne({ _id: new ObjectId(booking.equipmentId) })
      : null;

    const now = new Date();
    const review = {
      bookingId: bookingId.toString(),
      equipmentId: booking.equipmentId,
      equipmentName: typeof equipment?.name === "string" ? equipment.name : "Equipment",
      ownerId: typeof equipment?.ownerId === "string" ? equipment.ownerId : "",
      customerId: user.id,
      customerName: typeof booking.customerName === "string" && booking.customerName
        ? booking.customerName
        : "GearGrid customer",
      rating,
      comment,
      createdAt: now,
      updatedAt: now,
    };

    const result = await reviewsCollection().insertOne(review);

    res.status(201).json({ success: true, data: { _id: result.insertedId, ...review } });
  } catch (error) {
    next(error);
  }
});

reviewsRouter.delete("/:id", async (req, res, next) => {
  try {
    const user = actor(req);
    if (!user.id) {
      return res.status(401).json({ success: false, error: { message: "Sign in to manage reviews" } });
    }

    const _id = objectId(req.params.id);
    if (!_id) {
      return res.status(400).json({ success: false, error: { message: "Invalid review id" } });
    }

    const review = await reviewsCollection().findOne({ _id });
    if (!review) {
      return res.status(404).json({ success: false, error: { message: "Review not found" } });
    }
    if (review.customerId !== user.id && user.role !== "Admin") {
      return res.status(403).json({ success: false, error: { message: "You can only delete your own review" } });
    }

    await reviewsCollection().deleteOne({ _id });
    res.json({ success: true, data: { _id: req.params.id } });
  } catch (error) {
    next(error);
  }
});
