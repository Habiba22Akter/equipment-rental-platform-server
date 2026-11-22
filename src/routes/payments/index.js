import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../../config/database.js";
import { verifyToken } from "../../middleware/jwt-auth.js";

export const paymentsRouter = Router();

function paymentsCollection() {
  return getDatabase().collection("payments");
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

paymentsRouter.get("/", verifyToken, async (req, res, next) => {
  try {
    const filter = {};
    const customerId = textValue(req.query.customerId);
    const equipmentId = textValue(req.query.equipmentId);
    const status = textValue(req.query.status);
    const ownerId = textValue(req.query.ownerId);

    const user = req.user;
    if (user.role === "Customer") filter.customerId = user.id;
    else if (customerId) filter.customerId = customerId;
    if (equipmentId) filter.equipmentId = equipmentId;
    if (status) filter.status = status;

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

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const payments = await paymentsCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const ids = payments
      .map((payment) => payment.equipmentId)
      .filter((id) => typeof id === "string" && ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const equipment = ids.length
      ? await getDatabase()
          .collection("equipment")
          .find({ _id: { $in: ids } })
          .project({ name: 1, imageUrl: 1, category: 1 })
          .toArray()
      : [];
    const equipmentById = new Map(equipment.map((item) => [item._id.toString(), item]));

    const totalAmount = payments
      .filter((payment) => payment.status === "paid")
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);

    res.json({
      success: true,
      data: {
        payments: payments.map((payment) => ({
          ...payment,
          equipment: equipmentById.get(payment.equipmentId) ?? null,
        })),
        summary: {
          count: payments.length,
          paidCount: payments.filter((payment) => payment.status === "paid").length,
          totalAmount,
          currency: payments[0]?.currency ?? "usd",
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

paymentsRouter.get("/:id", verifyToken, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: { message: "Invalid payment id" } });
    }

    const payment = await paymentsCollection().findOne({ _id: new ObjectId(req.params.id) });
    if (!payment) {
      return res.status(404).json({ success: false, error: { message: "Payment not found" } });
    }

    const user = req.user;
    let allowed = user.role === "Admin" || (user.role === "Customer" && payment.customerId === user.id);
    if (user.role === "Owner" && ObjectId.isValid(payment.equipmentId)) {
      const equipment = await getDatabase().collection("equipment")
        .findOne({ _id: new ObjectId(payment.equipmentId) }, { projection: { ownerId: 1 } });
      allowed = equipment?.ownerId === user.id;
    }
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: "You cannot view this payment." } });
    }

    res.json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
});
