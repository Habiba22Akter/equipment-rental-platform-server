import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../../config/database.js";
import { env } from "../../config/env.js";
import { createCheckoutSession, stripe } from "../../stripe.js";
import { markBookingPaid } from "../../utils/mark-booking-paid.js";
import { verifyRenter, verifyToken } from "../../middleware/jwt-auth.js";

export const bookingsRouter = Router();

const BOOKING_STATUSES = ["pending", "confirmed", "active", "completed", "cancelled"];

function bookingsCollection() {
  return getDatabase().collection("bookings");
}

function actor(req) {
  return req.user ?? { id: "", role: "" };
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

bookingsRouter.post("/", verifyRenter, async (req, res, next) => {
  let booking;

  try {
    const user = actor(req);
    if (!user.id || user.role !== "Customer") {
      return res.status(403).json({ success: false, error: { message: "Only customers can create bookings." } });
    }
    if (!env.stripeSecretKey) {
      return res.status(500).json({ success: false, error: { message: "Add STRIPE_SECRET_KEY to the server .env file." } });
    }

    const { equipmentId, startDate, endDate, quantity, contactNumber, deliveryAddress, additionalNotes } = req.body ?? {};
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (!ObjectId.isValid(equipmentId) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) {
      return res.status(400).json({ success: false, error: { message: "Equipment, dates and quantity are required." } });
    }
    if (end < start) {
      return res.status(400).json({ success: false, error: { message: "End date must be on or after the start date." } });
    }

    const db = getDatabase();
    const equipment = await db.collection("equipment").findOne({ _id: new ObjectId(equipmentId) });
    if (!equipment || (equipment.status !== "approved" && equipment.approvalStatus !== "approved")) {
      return res.status(404).json({ success: false, error: { message: "Approved equipment was not found." } });
    }

    const rentalType = ["Weekly", "Monthly"].includes(equipment.rentalType) ? equipment.rentalType : "Daily";
    const dailyRate = Number(equipment.dailyRate ?? equipment.pricePerDay ?? 0);
    const rate = rentalType === "Weekly"
      ? Number(equipment.weeklyRate) || dailyRate * 7
      : rentalType === "Monthly"
        ? Number(equipment.monthlyRate) || dailyRate * 30
        : dailyRate;
    const days = Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
    const rentalUnits = rentalType === "Weekly" ? Math.ceil(days / 7) : rentalType === "Monthly" ? Math.ceil(days / 30) : days;
    const totalAmount = rate * rentalUnits * Number(quantity);
    const availableQuantity = Number(equipment.availableQuantity ?? equipment.quantity ?? 1);

    const overlappingBookings = await db.collection("bookings").find({
      equipmentId,
      paymentStatus: { $nin: ["cancelled", "failed"] },
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).toArray();
    const alreadyBooked = overlappingBookings.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
    if (alreadyBooked + Number(quantity) > availableQuantity) {
      return res.status(409).json({ success: false, error: { message: "Required quantity is not available for these dates." } });
    }
    if (totalAmount <= 0 || !Number.isFinite(totalAmount)) {
      return res.status(400).json({ success: false, error: { message: "Equipment has no valid rental price." } });
    }

    const amountUsdCents = Math.round((totalAmount / env.bdtPerUsd) * 100);
    booking = {
      equipmentId,
      customerId: user.id,
      customerName: String(req.body.customerName ?? "Customer"),
      customerEmail: String(req.body.customerEmail ?? ""),
      startDate: start,
      endDate: end,
      quantity: Number(quantity),
      contactNumber: String(contactNumber ?? ""),
      deliveryAddress: String(deliveryAddress ?? ""),
      additionalNotes: String(additionalNotes ?? ""),
      rentalType,
      rentalUnits,
      totalAmount,
      currency: "bdt",
      stripeAmountUsdCents: amountUsdCents,
      status: "pending",
      paymentStatus: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("bookings").insertOne(booking);
    booking._id = result.insertedId;

    const checkout = await createCheckoutSession({ booking, equipment, amountUsdCents });
    await db.collection("bookings").updateOne(
      { _id: booking._id },
      { $set: { stripeSessionId: checkout.id, updatedAt: new Date() } },
    );

    return res.status(201).json({
      success: true,
      data: { bookingId: booking._id.toString(), checkoutUrl: checkout.url },
    });
  } catch (error) {
    if (booking?._id) {
      await getDatabase().collection("bookings").updateOne(
        { _id: booking._id },
        { $set: { status: "pending", paymentStatus: "unpaid", updatedAt: new Date() } },
      );
    }
    next(error);
  }
});

// Reopen the existing booking's Stripe Checkout when the customer returns to pay.
bookingsRouter.post("/:id/checkout", verifyRenter, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: { message: "Invalid booking id." } });
    }

    const user = actor(req);
    const db = getDatabase();
    const booking = await db.collection("bookings").findOne({ _id: new ObjectId(req.params.id) });
    if (!booking) {
      return res.status(404).json({ success: false, error: { message: "Booking not found." } });
    }
    if (user.role !== "Customer" || booking.customerId !== user.id) {
      return res.status(403).json({ success: false, error: { message: "You cannot pay for this booking." } });
    }
    if (booking.paymentStatus === "paid") {
      return res.status(409).json({ success: false, error: { message: "This booking is already paid." } });
    }
    if (booking.status !== "pending") {
      return res.status(409).json({ success: false, error: { message: "Only pending bookings can be paid." } });
    }

    const equipment = await db.collection("equipment").findOne({ _id: new ObjectId(booking.equipmentId) });
    if (!equipment) {
      return res.status(404).json({ success: false, error: { message: "Equipment was not found." } });
    }

    if (booking.stripeSessionId) {
      const oldSession = stripe
        ? await stripe.checkout.sessions.retrieve(booking.stripeSessionId)
        : null;
      if (oldSession?.status === "open") {
        return res.json({ success: true, data: { checkoutUrl: oldSession.url } });
      }
      if (oldSession?.payment_status === "paid") {
        await markBookingPaid(db, booking, oldSession);
        return res.json({
          success: true,
          data: { checkoutUrl: `${env.appUrl}/payment/success?booking_id=${booking._id}` },
        });
      }
    }

    const overlaps = await db.collection("bookings").find({
      _id: { $ne: booking._id },
      equipmentId: booking.equipmentId,
      paymentStatus: { $nin: ["cancelled", "failed"] },
      startDate: { $lte: booking.endDate },
      endDate: { $gte: booking.startDate },
    }).toArray();
    const reserved = overlaps.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
    const available = Number(equipment.availableQuantity ?? equipment.quantity ?? 1);
    if (reserved + Number(booking.quantity) > available) {
      return res.status(409).json({ success: false, error: { message: "Equipment is no longer available for these dates." } });
    }

    if (!stripe) {
      return res.status(500).json({ success: false, error: { message: "Stripe is not configured on the server." } });
    }
    const checkout = await createCheckoutSession({
      booking,
      equipment,
      amountUsdCents: Number(booking.stripeAmountUsdCents),
    });
    await db.collection("bookings").updateOne(
      { _id: booking._id, paymentStatus: { $ne: "paid" } },
      { $set: { stripeSessionId: checkout.id, updatedAt: new Date() } },
    );

    return res.json({ success: true, data: { checkoutUrl: checkout.url } });
  } catch (error) {
    next(error);
  }
});

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

bookingsRouter.get("/", verifyToken, async (req, res, next) => {
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

    const user = actor(req);
    if (user.role === "Customer") filter.customerId = user.id;
    else if (customerId) filter.customerId = customerId;
    if (equipmentId) filter.equipmentId = equipmentId;
    if (status) {
      if (!BOOKING_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, error: { message: "Invalid booking status" } });
      }
      filter.status = status;
    }

    if (user.role === "Owner" || (user.role === "Admin" && ownerId)) {
      const effectiveOwnerId = user.role === "Owner" ? user.id : ownerId;
      const ownedEquipment = await getDatabase()
        .collection("equipment")
        .find({ ownerId: effectiveOwnerId })
        .project({ _id: 1 })
        .toArray();

      const allowedIds = ownedEquipment.map((item) => item._id.toString());
      filter.equipmentId = equipmentId && allowedIds.includes(equipmentId)
        ? equipmentId
        : { $in: allowedIds };
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

bookingsRouter.get("/:id", verifyToken, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: { message: "Invalid booking id" } });
    }

    const booking = await bookingsCollection().findOne({ _id: new ObjectId(req.params.id) });
    if (!booking) {
      return res.status(404).json({ success: false, error: { message: "Booking not found" } });
    }
    const user = actor(req);
    const equipment = ObjectId.isValid(booking.equipmentId)
      ? await getDatabase().collection("equipment").findOne({ _id: new ObjectId(booking.equipmentId) })
      : null;
    const isCustomer = user.role === "Customer" && booking.customerId === user.id;
    const isOwner = user.role === "Owner" && equipment?.ownerId === user.id;
    if (!isCustomer && !isOwner && user.role !== "Admin") {
      return res.status(403).json({ success: false, error: { message: "You cannot view this booking." } });
    }

    res.json({
      success: true,
      data: {
        ...booking,
        equipment: equipment ? {
          name: equipment.name ?? "Equipment",
          imageUrl: equipment.imageUrl ?? "",
        } : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

bookingsRouter.patch("/:id/status", verifyToken, async (req, res, next) => {
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
    if (status === "cancelled" && booking.paymentStatus === "paid") {
      return res.status(409).json({
        success: false,
        error: { message: "Paid bookings cannot be cancelled." },
      });
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

    const changes = { status, updatedAt: new Date() };
    if (status === "cancelled" && booking.paymentStatus !== "paid") {
      changes.paymentStatus = "cancelled";
    }
    await bookingsCollection().updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: changes },
    );

    res.json({ success: true, data: { _id: req.params.id, status } });
  } catch (error) {
    next(error);
  }
});
