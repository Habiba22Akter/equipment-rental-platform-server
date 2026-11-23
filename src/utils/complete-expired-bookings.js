import { ObjectId } from "mongodb";
import { getDatabase } from "../config/database.js";
import { sendBookingCompletedEmails } from "./booking-notifications.js";

export async function completeExpiredBookings() {
  const db = getDatabase();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expired = await db.collection("bookings").find({
    status: { $in: ["confirmed", "active"] },
    paymentStatus: "paid",
    endDate: { $lt: today },
  }).toArray();

  let completed = 0;
  for (const booking of expired) {
    const result = await db.collection("bookings").updateOne(
      { _id: booking._id, status: { $in: ["confirmed", "active"] }, paymentStatus: "paid" },
      { $set: { status: "completed", updatedAt: new Date() } },
    );
    if (result.modifiedCount) {
      completed += 1;
      await sendBookingCompletedEmails(db, {
        ...booking,
        _id: booking._id.toString(),
        equipmentObjectId: ObjectId.isValid(booking.equipmentId) ? new ObjectId(booking.equipmentId) : null,
      });
    }
  }
  return { completed };
}
