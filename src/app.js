
import express from "express";
import cookieSession from "cookie-session";
import authRouter, { isGuildMember } from "./auth.js";
import platformRouter from "./routes.js";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(express.json({ limit: "100kb" }));

app.use(cookieSession({
  name: "aeogen_session",
  keys: [
    process.env.SESSION_SECRET || "development-only-change-me"
  ],
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 8 * 60 * 60 * 1000
}));

app.use("/api/auth", authRouter);

export async function requireGuild(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      error: "LOGIN_REQUIRED"
    });
  }

  try {
    const isMember = await isGuildMember(req.session.user.id);

    if (!isMember) {
      req.session = null;

      return res.status(403).json({
        error: "GUILD_MEMBERSHIP_REQUIRED"
      });
    }

    next();
  } catch (error) {
    console.error("Membership check failed:", error.message);

    return res.status(503).json({
      error: "MEMBERSHIP_CHECK_UNAVAILABLE"
    });
  }
}

app.use("/api", requireGuild, platformRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "AeoGen" });
});

export default app;
