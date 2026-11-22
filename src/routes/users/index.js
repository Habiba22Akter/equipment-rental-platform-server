import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../../config/database.js";
import { verifyAdmin } from "../../middleware/jwt-auth.js";

export const usersRouter = Router();
usersRouter.use(verifyAdmin);

const ASSIGNABLE_ROLES = ["Customer", "Owner", "Admin"];

function usersCollection() {
  return getDatabase().collection("user");
}

function userId(value) {
  if (typeof value !== "string") return null;
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

async function isAdmin(req) {
  if (req.user?.role !== "Admin") return false;
  const _id = userId(req.user.id);
  if (!_id) return false;
  const user = await usersCollection().findOne({ _id }, { projection: { role: 1 } });
  return user?.role === "Admin";
}

usersRouter.get("/", async (req, res, next) => {
  try {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ success: false, error: { message: "Only admins can view users" } });
    }

    const filter = {};
    const role = typeof req.query.role === "string" ? req.query.role.trim() : "";

    if (role) {
      if (!["Customer", "Owner", "Admin"].includes(role)) {
        return res.status(400).json({ success: false, error: { message: "Invalid role filter" } });
      }
      filter.role = role;
    }

    const users = await usersCollection()
      .find(filter, { projection: { name: 1, email: 1, role: 1, image: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

usersRouter.get("/:id", async (req, res, next) => {
  try {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ success: false, error: { message: "Only admins can view users" } });
    }

    const _id = userId(req.params.id);
    if (!_id) {
      return res.status(400).json({ success: false, error: { message: "Invalid user id" } });
    }

    const user = await usersCollection().findOne(
      { _id },
      { projection: { name: 1, email: 1, role: 1, image: 1, createdAt: 1 } },
    );

    if (!user) {
      return res.status(404).json({ success: false, error: { message: "User not found" } });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

usersRouter.patch("/:id/role", async (req, res, next) => {
  try {
    if (!(await isAdmin(req))) {
      return res.status(403).json({
        success: false,
        error: { message: "Only admins can change account roles" },
      });
    }

    const _id = userId(req.params.id);
    if (!_id) {
      return res.status(400).json({ success: false, error: { message: "Invalid user id" } });
    }

    if (req.user.id === req.params.id) {
      return res.status(400).json({ success: false, error: { message: "You cannot change your own role" } });
    }

    const role = req.body?.role;
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: { message: "role must be Customer, Owner or Admin" },
      });
    }

    const result = await usersCollection().updateOne(
      { _id },
      { $set: { role, updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: { message: "User not found" } });
    }

    res.json({ success: true, data: { _id: req.params.id, role } });
  } catch (error) {
    next(error);
  }
});
