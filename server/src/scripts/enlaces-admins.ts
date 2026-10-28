/** 28-10-2026: nuevo enlace de invitación para Mario y Santiago (equivale a "Reenviar", sin email). */
import { connectDb, disconnectDb } from "../db/connect";
import { Invitation, User } from "../models";
import { audit } from "../services/audit";
import type { Actor } from "../services/actor";

const HASHES: Record<string, string> = { "mario@bemycar.pro": "0a3cff82620957b687fa6453180b7d0d6fe8d685987bbef03bded32e3cab0a36", "santiago@bemycar.pro": "69c8425208c45512d909b46f4447493d29c68985ef75e713507ccfb128ac20db" };

async function main() {
  await connectDb();
  try {
    const ig = (await User.findOne({ email: "ignacio@bemycar.pro" }).lean())!;
    const actor: Actor = { id: String(ig._id), role: "admin", name: ig.name };
    for (const [email, tokenHash] of Object.entries(HASHES)) {
      const u = (await User.findOne({ email }).lean())!;
      const r = await Invitation.findOneAndUpdate(
        { userId: u._id, usedAt: null, revokedAt: null },
        { $set: { tokenHash, expiresAt: new Date(Date.now() + 30 * 864e5) } },
        { sort: { createdAt: -1 }, new: true },
      );
      if (r) await audit.log(actor, "INVITATION_RESENT", { type: "invitation", id: String(r._id) }, null, { email, via: "enlace directo" }, null);
      console.log(`  ${email}: ${r ? "enlace actualizado" : "SIN INVITACION PENDIENTE"}`);
    }
    console.log("LINKS_DONE");
  } finally {
    await disconnectDb();
  }
}
main().catch((e) => { console.error("LINKS_FAILED", e); process.exitCode = 1; });
