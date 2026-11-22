import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../../config/database.js";

export const equipmentsRouter = Router();

const APPROVAL_STATUSES = ["pending", "approved", "rejected"];
const RENTAL_TYPES = ["Daily", "Weekly", "Monthly"];
const EQUIPMENT_CONDITIONS = ["New", "Like New", "Good", "Fair"];
const CATEGORY_DEFINITIONS = [
  { label: "Construction Equipment", aliases: ["construction", "construction equipment"] },
  { label: "Photography Equipment", aliases: ["photography", "photographic equipment", "photography equipment"] },
  { label: "Vehicles & Transportation", aliases: ["vehicle", "vehicles", "transportation", "vehicles and transportation"] },
  { label: "Agriculture Equipment", aliases: ["agriculture", "agricultural", "agriculture equipment"] },
  { label: "Electronics", aliases: ["electronic", "electronics"] },
  { label: "Event Equipment", aliases: ["event", "events", "event equipment"] },
];

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

function queryText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

function queryValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function normalizeCategory(value) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function categoryLabel(value) {
  const normalized = normalizeCategory(value);
  return CATEGORY_DEFINITIONS.find((definition) =>
    definition.aliases.some((alias) => normalizeCategory(alias) === normalized),
  )?.label ?? value;
}

function categoryAliases(value) {
  const normalized = normalizeCategory(value);
  const definition = CATEGORY_DEFINITIONS.find((definition) =>
    normalizeCategory(definition.label) === normalized ||
    definition.aliases.some((alias) => normalizeCategory(alias) === normalized),
  );
  return definition ? [definition.label, ...definition.aliases] : [value];
}

function rentalPriceExpression() {
  const dailyRate = { $ifNull: ["$dailyRate", "$pricePerDay"] };
  const weeklyRate = {
    $cond: [
      { $gt: [{ $ifNull: ["$weeklyRate", 0] }, 0] },
      "$weeklyRate",
      { $multiply: [dailyRate, 7] },
    ],
  };
  const monthlyRate = {
    $cond: [
      { $gt: [{ $ifNull: ["$monthlyRate", 0] }, 0] },
      "$monthlyRate",
      { $multiply: [dailyRate, 30] },
    ],
  };

  return {
    $switch: {
      branches: [
        { case: { $eq: ["$rentalType", "Weekly"] }, then: weeklyRate },
        { case: { $eq: ["$rentalType", "Monthly"] }, then: monthlyRate },
      ],
      default: dailyRate,
    },
  };
}

function optionalPrice(query, name) {
  const raw = queryText(query[name]);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : NaN;
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

function equipmentFilter(query, priceBounds) {
  const conditions = [];
  const filter = {};

  if (typeof query.ownerId === "string" && query.ownerId.trim()) {
    filter.ownerId = query.ownerId.trim();
  }

  const categories = queryValues(query.category);
  if (categories.length > 0) {
    conditions.push({
      $or: categories.map((category) => ({
        category: {
          $in: categoryAliases(category).map((value) => new RegExp(`^${escapeRegex(value)}$`, "i")),
        },
      })),
    });
  }

  if (typeof query.status === "string" && query.status.trim()) {
    const status = query.status.trim();
    conditions.push({ $or: [{ status }, { approvalStatus: status }] });
  } else if (query.all !== "true") {
    conditions.push({ $or: [{ status: "approved" }, { approvalStatus: "approved" }] });
  }

  const search = queryText(query.q);
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    conditions.push({
      $or: [{ name: pattern }, { location: pattern }],
    });
  }

  const rentalType = queryText(query.rentalType);
  if (rentalType && rentalType !== "all") {
    conditions.push({ rentalType: new RegExp(`^${escapeRegex(rentalType)}$`, "i") });
  }

  if (priceBounds.min !== undefined || priceBounds.max !== undefined) {
    const priceConditions = [];
    if (priceBounds.min !== undefined) priceConditions.push({ $gte: [rentalPriceExpression(), priceBounds.min] });
    if (priceBounds.max !== undefined) priceConditions.push({ $lte: [rentalPriceExpression(), priceBounds.max] });
    conditions.push({ $expr: { $and: priceConditions } });
  }

  const availability = queryText(query.availability);
  if (availability === "available") {
    conditions.push({
      $or: [
        { availableQuantity: { $gt: 0 } },
        { availableQuantity: { $exists: false }, quantity: { $gt: 0 } },
        { availableQuantity: { $exists: false }, quantity: { $exists: false } },
      ],
    });
  } else if (availability === "unavailable") {
    conditions.push({
      $or: [
        { availableQuantity: { $lte: 0 } },
        { availableQuantity: { $exists: false }, quantity: { $lte: 0 } },
      ],
    });
  }

  if (conditions.length > 0) filter.$and = conditions;

  return filter;
}

equipmentsRouter.get("/", async (req, res, next) => {
  try {
    const minPrice = optionalPrice(req.query, "minPrice");
    const maxPrice = optionalPrice(req.query, "maxPrice");
    if (Number.isNaN(minPrice) || Number.isNaN(maxPrice) || (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)) {
      return res.status(400).json({ success: false, error: { message: "Enter a valid minimum and maximum price range" } });
    }

    const requestedSort = queryText(req.query.sort);
    const sort = ["price-asc", "price-desc"].includes(requestedSort) ? requestedSort : "newest";
    const pipeline = [{ $match: equipmentFilter(req.query, { min: minPrice, max: maxPrice }) }];
    if (sort === "price-asc" || sort === "price-desc") {
      pipeline.push({ $addFields: { _rentalPriceForSort: rentalPriceExpression() } });
    }
    pipeline.push({
      $sort: sort === "price-asc"
        ? { _rentalPriceForSort: 1, createdAt: -1 }
        : sort === "price-desc"
          ? { _rentalPriceForSort: -1, createdAt: -1 }
          : { createdAt: -1 },
    });
    if (sort === "price-asc" || sort === "price-desc") {
      pipeline.push({ $project: { _rentalPriceForSort: 0 } });
    }

    const requestedLimit = queryText(req.query.limit);
    if (requestedLimit) {
      const parsedLimit = Number(requestedLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({ success: false, error: { message: "limit must be a positive integer" } });
      }
      pipeline.push({ $limit: Math.min(parsedLimit, 500) });
    }
    const equipments = await equipmentCollection()
      .aggregate(pipeline)
      .toArray();

    res.json({ success: true, data: equipments });
  } catch (error) {
    next(error);
  }
});

equipmentsRouter.get("/categories", async (_req, res, next) => {
  try {
    const categories = await equipmentCollection().distinct("category", {
      $or: [{ status: "approved" }, { approvalStatus: "approved" }],
    });
    const labels = categories
      .filter((category) => typeof category === "string" && category.trim())
      .map(categoryLabel);
    const data = [...new Set([...CATEGORY_DEFINITIONS.map((definition) => definition.label), ...labels])]
      .sort((a, b) => a.localeCompare(b));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

equipmentsRouter.get("/:id/availability", async (req, res, next) => {
  try {
    const id = objectId(req.params.id);
    const startDate = queryText(req.query.startDate);
    const endDate = queryText(req.query.endDate);
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (!id || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return res.status(400).json({ success: false, error: { message: "Equipment and valid rental dates are required." } });
    }

    const equipment = await equipmentCollection().findOne({ _id: id });
    if (!equipment) {
      return res.status(404).json({ success: false, error: { message: "Equipment not found." } });
    }

    const reservations = await getDatabase().collection("bookings").find({
      equipmentId: id.toString(),
      paymentStatus: { $nin: ["cancelled", "failed"] },
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).toArray();
    const totalQuantity = Number(equipment.availableQuantity ?? equipment.quantity ?? 1);
    const reservedQuantity = reservations.reduce((sum, booking) => sum + Number(booking.quantity ?? 0), 0);

    return res.json({
      success: true,
      data: {
        totalQuantity,
        reservedQuantity,
        availableQuantity: Math.max(0, totalQuantity - reservedQuantity),
      },
    });
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
    const required = ["name", "description", "category", "location", "imageUrl", "brand", "model", "condition", "terms", "ownerId"];

    for (const field of required) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        return res.status(400).json({
          success: false,
          error: { message: `${field} is required` },
        });
      }
    }

    if (!CATEGORY_DEFINITIONS.some((definition) => normalizeCategory(definition.label) === normalizeCategory(body.category))) {
      return res.status(400).json({ success: false, error: { message: "Choose a valid equipment category" } });
    }

    const rentalType = body.rentalType;
    const rentalPrice = Number(body.rentalPrice ?? body.dailyRate);
    const availableQuantity = Number(body.availableQuantity);
    if (!RENTAL_TYPES.includes(rentalType)) {
      return res.status(400).json({ success: false, error: { message: "rentalType must be Daily, Weekly or Monthly" } });
    }
    if (!Number.isFinite(rentalPrice) || rentalPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: { message: "rentalPrice must be greater than zero" },
      });
    }
    if (!EQUIPMENT_CONDITIONS.includes(body.condition)) {
      return res.status(400).json({ success: false, error: { message: "Choose a valid equipment condition" } });
    }
    if (!Number.isInteger(availableQuantity) || availableQuantity < 1) {
      return res.status(400).json({
        success: false,
        error: { message: "availableQuantity must be at least one" },
      });
    }

    const dailyRate = rentalType === "Weekly" ? rentalPrice / 7 : rentalType === "Monthly" ? rentalPrice / 30 : rentalPrice;
    const weeklyRate = rentalType === "Weekly" ? rentalPrice : dailyRate * 7;
    const monthlyRate = rentalType === "Monthly" ? rentalPrice : dailyRate * 30;
    const now = new Date();
    const result = await equipmentCollection().insertOne({
      name: body.name.trim(),
      description: body.description.trim(),
      category: body.category.trim(),
      brand: body.brand.trim(),
      model: body.model.trim(),
      condition: body.condition,
      location: body.location.trim(),
      imageUrl: body.imageUrl.trim(),
      dailyRate,
      weeklyRate,
      monthlyRate,
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

    for (const field of ["name", "description", "category", "brand", "model", "location", "imageUrl", "terms"]) {
      const value = textField(body, field);
      if (value !== null) updates[field] = value;
    }

    if (typeof body.condition === "string") {
      if (!EQUIPMENT_CONDITIONS.includes(body.condition)) {
        return res.status(400).json({ success: false, error: { message: "Choose a valid equipment condition" } });
      }
      updates.condition = body.condition;
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
