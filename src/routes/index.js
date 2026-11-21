import { Router } from "express";
import { bookingsRouter } from "./bookings/index.js";
import { equipmentsRouter } from "./equipments/index.js";
import { reviewsRouter } from "./reviews/index.js";
import { usersRouter } from "./users/index.js";

export const apiRouter = Router();

apiRouter.use("/users", usersRouter);
apiRouter.use("/equipments", equipmentsRouter);
apiRouter.use("/bookings", bookingsRouter);
apiRouter.use("/reviews", reviewsRouter);
