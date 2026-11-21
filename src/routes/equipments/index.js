import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../../config/database.js";

export const equipmentsRouter = Router();

const APPROVAL_STATUSES = ["pending", "approved", "rejected"];
const RENTAL_TYPES = ["Daily", "Weekly", "Monthly"];

function equipmentCollection() {
  return getDatabase().collection("equipment");
}

function objectId(value) {
  return typeof value === "string" && ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function actor(req) {
  return {
    id: req.get("x-user-id") ?? "",
    role: req.get("x-user-role") ?? "",
  };
}

function isAdmin(req) {
  return actor(req).role === "Admin";
}

function canManage(req, equipment) {
  if (isAdmin(req)) return true;
  const { id } = actor(req);
  return Boolean(id) && equipment.ownerId === id;
}

function textField(body, field) {
  const value = body?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(body, field) {
  if (body?.[field] === undefined || body?.[field] === null || body?.[field] === "") return null;
  const value = Number(body[field]);
  return Number.isFinite(value) ? value : null;
}

function equipmentFilter(query) {
  const conditions = [];
  const filter = {};

  if (typeof query.ownerId === "string" && query.ownerId.trim()) {
    filter.ownerId = query.ownerId.trim();
  }

  if (typeof query.category === "string" && query.category.trim()) {
    filter.category = query.category.trim();
  }

  if (typeof query.status === "string" && query.status.trim()) {
    const status = query.status.trim();
    conditions.push({ $or: [{ status }, { approvalStatus: status }] });
  } else if (query.all !== "true") {
    conditions.push({ $or: [{ status: "approved" }, { approvalStatus: "approved" }] });
  }

  if (typeof query.q === "string" && query.q.trim()) {
    const pattern = new RegExp(query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    conditions.push({
      $or: [{ name: pattern }, { description: pattern }, { location: pattern }, { category: pattern }],
    });
  }

  if (conditions.length > 0) filter.$and = conditions;

  return filter;
}

equipmentsRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const equipments = await equipmentCollection()
      .find(equipmentFilter(req.query))
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    res.json({ success: true, data: equipments });
  } catch (error) {
    next(error);
  }
});

equipmentsRouter.get("/:id", async (req, res, next) => {
  try {
    const _id = objectId(req.params.id);
    if (!_id) {
      return res.status(400).json({ success: false, error: { message: "Invalid equipment id" } });
    }

    const equipment = await equipmentCollection().findOne({ _id });
    if (!equipment) {
      return res.status(404).json({ success: false, error: { message: "Equipment not found" } });
    }

    res.json({ success: true, data: equipment });
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

    const rentalType = RENTAL_TYPES.includes(body.rentalType) ? body.rentalType : "Daily";
    const now = new Date();
    const result = await equipmentCollection().insertOne({
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

equipmentsRouter.patch("/:id", async (req, res, next) => {
  try {
    const _id = objectId(req.params.id);
    if (!_id) {
      return res.status(400).json({ success: false, error: { message: "Invalid equipment id" } });
    }

    const equipment = await equipmentCollection().findOne({ _id });
    if (!equipment) {
      return res.status(404).json({ success: false, error: { message: "Equipment not found" } });
    }
    if (!canManage(req, equipment)) {
      return res.status(403).json({
        success: false,
        error: { message: "You can only edit your own equipment" },
      });
    }

    const body = req.body ?? {};
    const updates = {};

    for (const field of ["name", "description", "category", "location", "imageUrl", "terms"]) {
      const value = textField(body, field);
      if (value !== null) updates[field] = value;
    }

    for (const field of ["dailyRate", "weeklyRate", "monthlyRate"]) {
      const value = numberField(body, field);
      if (value !== null) {
        if (value <= 0) {
          return res.status(400).json({
            success: false,
            error: { message: `${field} must be greater than zero` },
          });
        }
        updates[field] = value;
      }
    }

    const quantity = numberField(body, "availableQuantity");
    if (quantity !== null) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          error: { message: "availableQuantity must be at least one" },
        });
      }
      updates.availableQuantity = quantity;
      updates.quantity = quantity;
    }

    if (typeof body.rentalType === "string") {
      updates.rentalType = RENTAL_TYPES.includes(body.rentalType) ? body.rentalType : "Daily";
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: "No supported fields were provided" },
      });
    }

    // Owner edits go back into the review queue. Admin edits keep the current
    // approval state so corrections do not hide a listing from customers.
    if (!isAdmin(req)) {
      updates.status = "pending";
      updates.approvalStatus = "pending";
    }

    updates.updatedAt = new Date();
    await equipmentCollection().updateOne({ _id }, { $set: updates });

    res.json({ success: true, data: { _id: _id.toString() } });
  } catch (error) {
    next(error);
  }
});

equipmentsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({
        success: false,
        error: { message: "Only admins can review equipment" },
      });
    }

    const _id = objectId(req.params.id);
    if (!_id) {
      return res.status(400).json({ success: false, error: { message: "Invalid equipment id" } });
    }

    const status = req.body?.status;
    if (!APPROVAL_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: "status must be pending, approved or rejected" },
      });
    }

    const result = await equipmentCollection().updateOne(
      { _id },
      {
        $set: {
          status,
          approvalStatus: status,
          reviewedBy: actor(req).id || null,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: { message: "Equipment not found" } });
    }

    res.json({ success: true, data: { _id: _id.toString(), status } });
  } catch (error) {
    next(error);
  }
});

equipmentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const _id = objectId(req.params.id);
    if (!_id) {
      return res.status(400).json({ success: false, error: { message: "Invalid equipment id" } });
    }

    const equipment = await equipmentCollection().findOne({ _id });
    if (!equipment) {
      return res.status(404).json({ success: false, error: { message: "Equipment not found" } });
    }
    if (!canManage(req, equipment)) {
      return res.status(403).json({
        success: false,
        error: { message: "You can only delete your own equipment" },
      });
    }

    const activeBookings = await getDatabase().collection("bookings").countDocuments({
      equipmentId: _id.toString(),
      status: { $in: ["confirmed", "active"] },
    });
    if (activeBookings > 0) {
      return res.status(409).json({
        success: false,
        error: { message: "This equipment has active bookings and cannot be deleted yet" },
      });
    }

    await equipmentCollection().deleteOne({ _id });

    res.json({ success: true, data: { _id: _id.toString() } });
  } catch (error) {
    next(error);
  }
});
