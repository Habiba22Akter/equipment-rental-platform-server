import { ObjectId } from "mongodb";
import { env } from "../../config/env.js";
import { getDatabase } from "../../config/database.js";
import { stripe } from "../../stripe.js";
import { markBookingPaid } from "../../utils/mark-booking-paid.js";

export async function stripeWebhook(req, res) {
  if (!stripe) {
    return res.status(500).json({
      success: false,
      error: { message: "STRIPE_SECRET_KEY is missing on the server." },
    });
  }
  if (!env.stripeWebhookSecret) {
    return res.status(500).json({
      success: false,
      error: { message: "STRIPE_WEBHOOK_SECRET is missing on the server." },
    });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.get("stripe-signature"),
      env.stripeWebhookSecret,
    );
  } catch {
    return res.status(400).json({
      success: false,
      error: { message: "Invalid Stripe webhook signature." },
    });
  }

  if (!["checkout.session.completed", "checkout.session.expired"].includes(event.type)) {
    return res.json({ success: true, data: { received: true } });
  }

  const session = event.data.object;
  const bookingId = session.metadata?.bookingId ?? session.client_reference_id;
  if (!bookingId || !ObjectId.isValid(bookingId)) {
    return res.status(400).json({
      success: false,
      error: { message: "Booking id is missing from the Stripe session." },
    });
  }

  const db = getDatabase();
  const bookings = db.collection("bookings");
  const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });
  if (!booking) {
    return res.status(404).json({ success: false, error: { message: "Booking not found." } });
  }

  if (event.type === "checkout.session.completed" && session.payment_status === "paid") {
    await markBookingPaid(db, booking, session);
  }

  if (event.type === "checkout.session.expired") {
    await bookings.updateOne(
      { _id: booking._id, stripeSessionId: session.id, paymentStatus: { $ne: "paid" } },
      { $set: { status: "pending", paymentStatus: "unpaid", updatedAt: new Date() } },
    );
  }

  return res.json({ success: true, data: { received: true } });
}
