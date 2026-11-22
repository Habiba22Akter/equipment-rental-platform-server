export async function markBookingPaid(db, booking, session) {
  await db.collection("bookings").updateOne(
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

  const payments = db.collection("payments");
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
