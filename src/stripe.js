import Stripe from "stripe";
import { env } from "./config/env.js";

export const stripe = env.stripeSecretKey
  ? new Stripe(env.stripeSecretKey)
  : null;

export async function createCheckoutSession({ booking, equipment, amountUsdCents }) {
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is missing from the server .env file.");

  return stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: booking.customerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountUsdCents,
          product_data: {
            name: equipment.name,
            description: `${booking.quantity} item(s) for ${booking.rentalUnits} ${booking.rentalType.toLowerCase()} unit(s)`,
          },
        },
      },
    ],
    success_url: `${env.appUrl}/payment/success?booking_id=${booking._id}`,
    cancel_url: `${env.appUrl}/payment/cancel?booking_id=${booking._id}`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    client_reference_id: booking._id.toString(),
    metadata: {
      bookingId: booking._id.toString(),
      equipmentId: booking.equipmentId,
      customerId: booking.customerId,
    },
  });
}
