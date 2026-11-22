import { ObjectId } from "mongodb";
import { env } from "../../config/env.js";
import { getDatabase } from "../../config/database.js";
import { stripe } from "../../stripe.js";

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
  const payments = db.collection("payments");
  const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });
  if (!booking) {
    return res.status(404).json({ success: false, error: { message: "Booking not found." } });
  }

  if (event.type === "checkout.session.completed" && session.payment_status === "paid") {
    await bookings.updateOne(
      { _id: booking._id },
      {
        $set: {
          status: "confirmed",
          paymentStatus: "paid",
          stripeSessionId: session.id,
          updatedAt: new Date(),
        },
      },
    );

    const existingPayment = await payments.findOne({ stripeSessionId: session.id });
    if (!existingPayment) {
      await payments.insertOne({
        bookingId: booking._id.toString(),
        customerId: booking.customerId,
        equipmentId: booking.equipmentId,
        stripeSessionId: session.id,
        stripePaymentIntentId: session.payment_intent ?? null,
        amount: (session.amount_total ?? booking.stripeAmountUsdCents) / 100,
        amountBdt: booking.totalAmount,
        currency: "usd",
        status: "paid",
        createdAt: new Date(),
      });
    }
  }

  if (event.type === "checkout.session.expired") {
    await bookings.updateOne(
      { _id: booking._id, paymentStatus: "pending" },
      { $set: { status: "cancelled", paymentStatus: "cancelled", updatedAt: new Date() } },
    );
  }

  return res.json({ success: true, data: { received: true } });
}
