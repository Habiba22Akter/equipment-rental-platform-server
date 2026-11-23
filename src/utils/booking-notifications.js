import { env } from "../config/env.js";

export async function sendBookingCompletedEmails(db, booking) {
  if (!env.resendApiKey || !env.emailFrom) {
    console.log("Booking completion email skipped: set RESEND_API_KEY and EMAIL_FROM.");
    return;
  }

  const equipment = booking.equipmentObjectId
    ? await db.collection("equipment").findOne({ _id: booking.equipmentObjectId })
    : null;
  const equipmentName = equipment?.name ?? "your equipment rental";
  const recipients = [
    { email: booking.customerEmail, name: booking.customerName ?? "Customer" },
    { email: equipment?.ownerEmail, name: equipment?.ownerName ?? "Owner" },
  ].filter((person) => person.email);

  for (const person of recipients) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.emailFrom,
          to: [person.email],
          subject: "Your GearGrid rental is complete",
          text: `Hello ${person.name}, the rental for ${equipmentName} has been marked complete. Booking: ${booking._id}`,
        }),
      });
      if (!response.ok) console.error("Could not send booking completion email:", await response.text());
    } catch (error) {
      console.error("Could not send booking completion email:", error.message);
    }
  }
}
