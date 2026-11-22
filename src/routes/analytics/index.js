import { Router } from "express";
import { getDatabase } from "../../config/database.js";
import { verifyToken } from "../../middleware/jwt-auth.js";

export const analyticsRouter = Router();

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

analyticsRouter.get("/", verifyToken, async (req, res, next) => {
  try {
    const db = getDatabase();
    const now = new Date();
    const firstMonth = monthStart(now);
    firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 5);

    if (req.user.role === "Admin") {
      const [totalUsers, totalEquipment, totalBookings, pendingApprovals, completedRentals, paidPayments, monthlyRows] = await Promise.all([
        db.collection("user").countDocuments(),
        db.collection("equipment").countDocuments(),
        db.collection("bookings").countDocuments(),
        db.collection("equipment").countDocuments({ $or: [{ status: "pending" }, { approvalStatus: "pending" }] }),
        db.collection("bookings").countDocuments({ status: "completed" }),
        db.collection("payments").find({ status: "paid" }).project({ amountBdt: 1, createdAt: 1 }).toArray(),
        db.collection("bookings").aggregate([
          { $match: { createdAt: { $gte: firstMonth } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" }, }, bookings: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]).toArray(),
      ]);

      const bookingCounts = new Map(monthlyRows.map((row) => [row._id, row.bookings]));
      const monthlyBookingStats = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(firstMonth);
        date.setUTCMonth(date.getUTCMonth() + index);
        const month = date.toISOString().slice(0, 7);
        return { month, bookings: bookingCounts.get(month) ?? 0 };
      });

      return res.json({
        success: true,
        data: {
          role: "Admin",
          totalUsers,
          totalEquipment,
          totalBookings,
          pendingApprovals,
          completedRentals,
          totalRevenueBdt: paidPayments.reduce((sum, payment) => sum + Number(payment.amountBdt ?? 0), 0),
          monthlyBookingStats,
        },
      });
    }

    if (req.user.role === "Owner") {
      const ownerEquipment = await db.collection("equipment")
        .find({ ownerId: req.user.id })
        .project({ _id: 1 })
        .toArray();
      const equipmentIds = ownerEquipment.map((item) => item._id.toString());

      if (equipmentIds.length === 0) {
        return res.json({
          success: true,
          data: { role: "Owner", totalListedEquipment: 0, completedRentals: 0, totalEarningsBdt: 0, monthlyEarnings: Array.from({ length: 6 }, (_, index) => {
            const date = new Date(firstMonth);
            date.setUTCMonth(date.getUTCMonth() + index);
            return { month: date.toISOString().slice(0, 7), earningsBdt: 0 };
          }) },
        });
      }

      const [completedRentals, paidPayments, monthlyRows] = await Promise.all([
        db.collection("bookings").countDocuments({ equipmentId: { $in: equipmentIds }, status: "completed" }),
        db.collection("payments").find({ equipmentId: { $in: equipmentIds }, status: "paid" }).project({ amountBdt: 1, createdAt: 1 }).toArray(),
        db.collection("payments").aggregate([
          { $match: { equipmentId: { $in: equipmentIds }, status: "paid", createdAt: { $gte: firstMonth } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, earningsBdt: { $sum: "$amountBdt" } } },
          { $sort: { _id: 1 } },
        ]).toArray(),
      ]);

      const earnings = new Map(monthlyRows.map((row) => [row._id, row.earningsBdt]));
      const monthlyEarnings = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(firstMonth);
        date.setUTCMonth(date.getUTCMonth() + index);
        const month = date.toISOString().slice(0, 7);
        return { month, earningsBdt: earnings.get(month) ?? 0 };
      });

      return res.json({
        success: true,
        data: {
          role: "Owner",
          totalListedEquipment: ownerEquipment.length,
          completedRentals,
          totalEarningsBdt: paidPayments.reduce((sum, payment) => sum + Number(payment.amountBdt ?? 0), 0),
          monthlyEarnings,
        },
      });
    }

    return res.status(403).json({ success: false, error: { message: "Analytics are available to owners and admins." } });
  } catch (error) {
    return next(error);
  }
});
