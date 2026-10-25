
import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";

const router = Router();

function isAdmin(req) {
  const ids = (process.env.ADMIN_DISCORD_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return ids.includes(req.session?.user?.id);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "ADMIN_REQUIRED" });
  }

  next();
}

// Listar plataformas y stock disponible.
router.get("/platforms", async (_req, res) => {
  try {
    const db = await getDb();

    const platforms = await db.collection("platforms")
      .aggregate([
        { $match: { active: true } },
        {
          $lookup: {
            from: "inventory",
            let: { pid: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$platformId", "$$pid"] }
                }
              },
              { $count: "count" }
            ],
            as: "stockInfo"
          }
        },
        {
          $project: {
            name: 1,
            description: 1,
            type: 1,
            stock: {
              $ifNull: [
                { $arrayElemAt: ["$stockInfo.count", 0] },
                0
              ]
            }
          }
        },
        { $sort: { name: 1 } }
      ]).toArray();

    res.json({ platforms });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "DATABASE_ERROR" });
  }
});

// Crear plataforma: solo administradores.
router.post("/platforms", requireAdmin, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();

  if (!name || name.length > 60 || description.length > 200) {
    return res.status(400).json({ error: "INVALID_PLATFORM" });
  }

  try {
    const db = await getDb();

    const result = await db.collection("platforms").insertOne({
      name,
      description,
      type: "test-data",
      active: true,
      createdAt: new Date(),
      createdBy: req.session.user.id
    });

    res.status(201).json({
      platform: {
        id: result.insertedId.toString(),
        name,
        description,
        stock: 0
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "DATABASE_ERROR" });
  }
});

// Importar líneas de datos sintéticos.
router.post(
  "/platforms/:id/import",
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const lines = req.body?.lines;

    if (!ObjectId.isValid(id) || !Array.isArray(lines)) {
      return res.status(400).json({ error: "INVALID_IMPORT" });
    }

    if (lines.length > 1000) {
      return res.status(413).json({ error: "IMPORT_TOO_LARGE" });
    }

    const values = lines.map((line) =>
      typeof line === "string" ? line.trim() : ""
    ).filter(Boolean);

    if (
      values.some((value) =>
        !value.startsWith("TEST:") || value.length > 500
      )
    ) {
      return res.status(400).json({
        error: "ONLY_SYNTHETIC_TEST_ENTRIES_ALLOWED",
        message: "Cada entrada debe comenzar con TEST:."
      });
    }

    if (new Set(values).size !== values.length) {
      return res.status(400).json({
        error: "DUPLICATE_ENTRIES",
        message: "El archivo contiene entradas repetidas."
      });
    }

    try {
      const db = await getDb();
      const platformId = new ObjectId(id);

      const platform = await db.collection("platforms").findOne({
        _id: platformId,
        active: true
      });

      if (!platform) {
        return res.status(404).json({ error: "PLATFORM_NOT_FOUND" });
      }

      if (values.length) {
        await db.collection("inventory").insertMany(
          values.map((value) => ({
            platformId,
            value,
            createdAt: new Date()
          })),
          { ordered: true }
        );
      }

      res.json({ imported: values.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "IMPORT_FAILED" });
    }
  }
);

// Consumir exactamente una entrada de prueba.
router.post("/platforms/:id/generate", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "INVALID_PLATFORM_ID" });
  }

  try {
    const db = await getDb();
    const platformId = new ObjectId(id);

    const platform = await db.collection("platforms").findOne({
      _id: platformId,
      active: true
    });

    if (!platform) {
      return res.status(404).json({ error: "PLATFORM_NOT_FOUND" });
    }

    // findOneAndDelete reclama una sola entrada de forma atómica.
    const item = await db.collection("inventory").findOneAndDelete({
      platformId
    });

    if (!item) {
      return res.status(409).json({ error: "OUT_OF_STOCK" });
    }

    await db.collection("redemptions").insertOne({
      platformId,
      userId: req.session.user.id,
      consumedAt: new Date()
    });

    res.set("Cache-Control", "no-store");
    res.json({
      value: item.value,
      remaining: await db.collection("inventory").countDocuments({
        platformId
      })
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "GENERATION_FAILED" });
  }
});

export default router;
