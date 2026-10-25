
import { Router } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";

const router = Router();

const discordApi = "https://discord.com/api/v10";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length &&
    timingSafeEqual(left, right);
}

export async function isGuildMember(userId) {
  if (
    !process.env.DISCORD_BOT_TOKEN ||
    !process.env.DISCORD_GUILD_ID
  ) {
    throw new Error("Discord no está configurado");
  }

  const response = await fetch(
    `${discordApi}/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`,
    {
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
      },
      signal: AbortSignal.timeout(5000)
    }
  );

  if (response.status === 404) return false;

  if (!response.ok) {
    throw new Error(
      `No se pudo comprobar la membresía (${response.status})`
    );
  }

  return true;
}

router.get("/login", (req, res) => {
  const state = randomBytes(32).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params}`
  );
});

router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const expectedState = req.session?.oauthState;

    delete req.session.oauthState;

    if (
      typeof code !== "string" ||
      !safeEqual(state, expectedState)
    ) {
      return res.status(400).send("Login inválido. Intenta de nuevo.");
    }

    const tokenResponse = await fetch(
      `${discordApi}/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: process.env.DISCORD_REDIRECT_URI
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!tokenResponse.ok) {
      return res.status(401).send("No se pudo completar el login.");
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch(
      `${discordApi}/users/@me`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        },
        signal: AbortSignal.timeout(5000)
      }
    );

    if (!userResponse.ok) {
      return res.status(401).send("No se pudo verificar tu cuenta.");
    }

    const user = await userResponse.json();

    if (!(await isGuildMember(user.id))) {
      req.session = null;

      return res.redirect(
        `/?error=not_member`
      );
    }

    // Guardar solo los datos necesarios.
    // No necesitamos conservar el token OAuth de Discord.
    req.session = {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar ?? null
      },
      authenticatedAt: Date.now()
    };

    return res.redirect("/");
  } catch (error) {
    console.error("Error en autenticación:", error.message);
    return res.status(503).send(
      "No se pudo verificar el acceso. Intenta más tarde."
    );
  }
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.status(200).json({ ok: true });
});

router.get("/me", async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: "LOGIN_REQUIRED" });
  }

  try {
    const member = await isGuildMember(req.session.user.id);

    if (!member) {
      req.session = null;
      return res.status(403).json({
        error: "GUILD_MEMBERSHIP_REQUIRED"
      });
    }

    return res.json({ user: req.session.user });
  } catch (error) {
    console.error("Error verificando membresía:", error.message);
    return res.status(503).json({
      error: "MEMBERSHIP_CHECK_UNAVAILABLE"
    });
  }
});

export default router;
