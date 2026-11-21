import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../../config/database.js";

export const bookingsRouter = Router();

const BOOKING_STATUSES = ["confirmed", "active", "completed", "cancelled"];

function bookingsCollection() {
  return getDatabase().collection("bookings");
}

function actor(req) {
  return {
    id: req.get("x-user-id") ?? "",
    role: req.get("x-user-role") ?? "",
  };
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function equipmentDetails(equipmentIds) {
  const ids = equipmentIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (ids.length === 0) return new Map();

  const equipment = await getDatabase()
    .collection("equipment")
    .find({ _id: { $in: ids } })
    .project({ name: 1, imageUrl: 1, category: 1, location: 1, ownerId: 1, ownerName: 1, ownerEmail: 1 })
    .toArray();

  return new Map(equipment.map((item) => [item._id.toString(), item]));
}

bookingsRouter.get("/", async (req, res, next) => {
  try {
    const filter = {};
    const customerId = textValue(req.query.customerId);
    const equipmentId = textValue(req.query.equipmentId);
    const status = textValue(req.query.status);
    const ownerId = textValue(req.query.ownerId);
    const rawSkip = req.query.skip === undefined ? "0" : textValue(req.query.skip);
    const skip = rawSkip === null ? Number.NaN : Number(rawSkip);
    if (!Number.isInteger(skip) || skip < 0) {
      return res.status(400).json({ success: false, error: { message: "skip must be a non-negative integer" } });
    }

    if (customerId) filter.customerId = customerId;
    if (equipmentId) filter.equipmentId = equipmentId;
    if (status) {
      if (!BOOKING_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, error: { message: "Invalid booking status" } });
      }
      filter.status = status;
    }

    if (ownerId) {
      const ownedEquipment = await getDatabase()
        .collection("equipment")
        .find({ ownerId })
        .project({ _id: 1 })
        .toArray();

      filter.equipmentId = { $in: ownedEquipment.map((item) => item._id.toString()) };
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const bookings = await bookingsCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const equipment = await equipmentDetails(bookings.map((booking) => booking.equipmentId));

    res.json({
      success: true,
      data: bookings.map((booking) => {
        const item = equipment.get(booking.equipmentId);
        return {
          ...booking,
          equipment: item
            ? {
                name: item.name ?? "Equipment",
                imageUrl: item.imageUrl ?? "",
                category: item.category ?? "Equipment",
                location: item.location ?? "",
                ownerId: item.ownerId ?? "",
                ownerName: item.ownerName ?? "",
                ownerEmail: item.ownerEmail ?? "",
              }
            : null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

bookingsRouter.get("/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: { message: "Invalid booking id" } });
    }

    const booking = await bookingsCollection().findOne({ _id: new ObjectId(req.params.id) });
    if (!booking) {
      return res.status(404).json({ success: false, error: { message: "Booking not found" } });
    }

    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
});

bookingsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: { message: "Invalid booking id" } });
    }

    const status = req.body?.status;
    if (!BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: `status must be one of: ${BOOKING_STATUSES.join(", ")}` },
      });
    }

    const booking = await bookingsCollection().findOne({ _id: new ObjectId(req.params.id) });
    if (!booking) {
      return res.status(404).json({ success: false, error: { message: "Booking not found" } });
    }

    const user = actor(req);
    const isCustomer = user.id && booking.customerId === user.id;
    const isAdmin = user.role === "Admin";

    let isOwner = false;
    if (user.id && ObjectId.isValid(booking.equipmentId)) {
      const equipment = await getDatabase()
        .collection("equipment")
        .findOne({ _id: new ObjectId(booking.equipmentId) });
      isOwner = equipment?.ownerId === user.id;
    }

    // Customers may only cancel their own booking. Owners and admins can move
    // a booking through the fulfilment states.
    if (isCustomer && !isOwner && !isAdmin) {
      if (status !== "cancelled") {
        return res.status(403).json({
          success: false,
          error: { message: "Customers can only cancel their own booking" },
        });
      }
    } else if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: { message: "You cannot update this booking" },
      });
    }

    await bookingsCollection().updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } },
    );

    res.json({ success: true, data: { _id: req.params.id, status } });
  } catch (error) {
    next(error);
  }
});
