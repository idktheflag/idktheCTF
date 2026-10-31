import { and, asc, eq, lt } from "drizzle-orm";
import { Context, Hono } from "hono";
import { JwtVariables } from "hono/jwt";
import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { adminMiddleware } from "../middlewares/admin";
import { authMiddleware } from "../middlewares/auth";
import { teamMiddleware } from "../middlewares/team";
import { writeAudit } from "../utils/audit";

const router = new Hono<{ Bindings: Bindings; Variables: JwtVariables }>();
const allowedTypes = new Set(["application/zip", "application/x-zip-compressed", "application/gzip", "application/pdf", "text/plain", "application/octet-stream", "image/png", "image/jpeg"]);
const DAY = 24 * 60 * 60 * 1000;
const PREFERRED_PART_SIZE = 16 * 1024 * 1024;
const MAX_PART_SIZE = 90 * 1024 * 1024;
const MAX_PARTS = 10_000;
const MAX_R2_OBJECT_SIZE = 5 * 1024 ** 4 - 5 * 1024 ** 3;

const eventAllowsFiles = async (c: { env: Bindings }) => {
  const event = await c.env.DATABASE.prepare("SELECT starts_at, ends_at, view_challenges_after_end FROM event_settings WHERE id = 1").first() as { starts_at: number | null; ends_at: number | null; view_challenges_after_end: number } | null;
  return !event || ((!event.starts_at || Date.now() >= event.starts_at) && (!event.ends_at || Date.now() <= event.ends_at || Boolean(event.view_challenges_after_end)));
};

const sanitizeFilename = (name: string) => name.split(/[\\/]/).pop()?.replace(/[\r\n\x00-\x1f]/g, "_").slice(0, 180) || "attachment";

async function pruneExpiredUploads(c: Context<{ Bindings: Bindings; Variables: JwtVariables }>) {
  const db = getDB(c);
  const expired = await db.select().from(schema.attachmentUploads).where(lt(schema.attachmentUploads.expiresAt, new Date())).limit(25);
  for (const session of expired) {
    try { await c.env.FILES.resumeMultipartUpload(session.objectKey, session.uploadId).abort(); } catch { /* R2 expires abandoned multipart uploads after seven days. */ }
    await db.delete(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, session.id));
  }
}

router.post("/multipart", authMiddleware, adminMiddleware, async (c) => {
  const input = await c.req.json<{ challengeId?: string; filename?: string; contentType?: string; size?: number }>();
  const challengeId = typeof input.challengeId === "string" ? input.challengeId : "";
  const filename = sanitizeFilename(typeof input.filename === "string" ? input.filename : "");
  const declaredType = typeof input.contentType === "string" ? input.contentType : "";
  const size = Number(input.size);
  if (!challengeId || !Number.isSafeInteger(size) || size < 1) return c.json({ error: "Choose a challenge and a non-empty file" }, 400);
  if (size > MAX_R2_OBJECT_SIZE) return c.json({ error: "This file is larger than the maximum object size supported by Cloudflare R2" }, 413);
  const contentType = allowedTypes.has(declaredType) ? declaredType : "application/octet-stream";
  if (contentType === "application/octet-stream" && declaredType && declaredType !== "application/octet-stream") return c.json({ error: "This file type is not supported" }, 415);
  const challenge = await getDB(c).select({ id: schema.challenges.id }).from(schema.challenges).where(eq(schema.challenges.id, challengeId)).get();
  if (!challenge) return c.json({ error: "Challenge not found" }, 404);

  await pruneExpiredUploads(c);
  const minimumPartSize = Math.ceil(size / MAX_PARTS);
  const partSize = Math.max(PREFERRED_PART_SIZE, Math.ceil(minimumPartSize / (1024 * 1024)) * 1024 * 1024);
  if (partSize > MAX_PART_SIZE) return c.json({ error: "This upload exceeds the per-request size and multipart part-count limits available through this Worker. Use a Cloudflare zone plan with a larger request body allowance." }, 413);

  const sessionId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  const objectKey = `${challengeId}/${attachmentId}`;
  const multipart = await c.env.FILES.createMultipartUpload(objectKey, { httpMetadata: { contentType } });
  const expiresAt = new Date(Date.now() + 7 * DAY);
  try {
    await getDB(c).insert(schema.attachmentUploads).values({
      id: sessionId, attachmentId, challengeId, ownerId: c.get("jwtPayload").userId,
      objectKey, uploadId: multipart.uploadId, filename, contentType, size, partSize, expiresAt,
    }).run();
  } catch (error) {
    await multipart.abort();
    throw error;
  }
  return c.json({ uploadId: sessionId, attachmentId, filename, contentType, size, partSize, totalParts: Math.ceil(size / partSize), expiresAt }, 201);
});

router.get("/multipart/:id", authMiddleware, adminMiddleware, async (c) => {
  const session = await getDB(c).select().from(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, c.req.param("id"))).get();
  if (!session || session.ownerId !== c.get("jwtPayload").userId) return c.json({ error: "Upload session not found" }, 404);
  if (session.expiresAt.getTime() <= Date.now()) {
    try { await c.env.FILES.resumeMultipartUpload(session.objectKey, session.uploadId).abort(); } catch { /* The R2 multipart upload may already have expired. */ }
    await getDB(c).delete(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, session.id));
    return c.json({ error: "Upload session expired. Start the upload again." }, 410);
  }
  const parts = await getDB(c).select({ partNumber: schema.attachmentUploadParts.partNumber, etag: schema.attachmentUploadParts.etag, size: schema.attachmentUploadParts.size }).from(schema.attachmentUploadParts).where(eq(schema.attachmentUploadParts.sessionId, session.id)).orderBy(asc(schema.attachmentUploadParts.partNumber));
  return c.json({ uploadId: session.id, attachmentId: session.attachmentId, challengeId: session.challengeId, filename: session.filename, contentType: session.contentType, size: session.size, partSize: session.partSize, totalParts: Math.ceil(session.size / session.partSize), expiresAt: session.expiresAt, parts });
});

router.put("/multipart/:id/parts/:partNumber", authMiddleware, adminMiddleware, async (c) => {
  const session = await getDB(c).select().from(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, c.req.param("id"))).get();
  if (!session || session.ownerId !== c.get("jwtPayload").userId) return c.json({ error: "Upload session not found" }, 404);
  if (session.expiresAt.getTime() <= Date.now()) return c.json({ error: "Upload session expired. Start the upload again." }, 410);
  const partNumber = Number(c.req.param("partNumber"));
  const totalParts = Math.ceil(session.size / session.partSize);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts || partNumber > MAX_PARTS) return c.json({ error: "Invalid upload part number" }, 400);
  const bytes = await c.req.arrayBuffer();
  const expectedSize = partNumber === totalParts ? session.size - session.partSize * (totalParts - 1) : session.partSize;
  if (bytes.byteLength !== expectedSize || bytes.byteLength > MAX_PART_SIZE) return c.json({ error: "Upload part size does not match the expected chunk" }, 400);
  const upload = c.env.FILES.resumeMultipartUpload(session.objectKey, session.uploadId);
  const part = await upload.uploadPart(partNumber, bytes);
  await getDB(c).insert(schema.attachmentUploadParts).values({ sessionId: session.id, partNumber, etag: part.etag, size: bytes.byteLength })
    .onConflictDoUpdate({ target: [schema.attachmentUploadParts.sessionId, schema.attachmentUploadParts.partNumber], set: { etag: part.etag, size: bytes.byteLength } }).run();
  return c.json({ partNumber: part.partNumber, etag: part.etag, size: bytes.byteLength });
});

router.post("/multipart/:id/complete", authMiddleware, adminMiddleware, async (c) => {
  const db = getDB(c);
  const session = await db.select().from(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, c.req.param("id"))).get();
  if (!session || session.ownerId !== c.get("jwtPayload").userId) return c.json({ error: "Upload session not found" }, 404);
  if (session.expiresAt.getTime() <= Date.now()) return c.json({ error: "Upload session expired. Start the upload again." }, 410);
  const expectedParts = Math.ceil(session.size / session.partSize);
  const parts = await db.select().from(schema.attachmentUploadParts).where(eq(schema.attachmentUploadParts.sessionId, session.id)).orderBy(asc(schema.attachmentUploadParts.partNumber));
  if (parts.length !== expectedParts || parts.some((part, index) => part.partNumber !== index + 1 || part.size !== (index + 1 === expectedParts ? session.size - session.partSize * (expectedParts - 1) : session.partSize))) {
    return c.json({ error: "Upload is incomplete. Retry missing parts before completing." }, 409);
  }
  const upload = c.env.FILES.resumeMultipartUpload(session.objectKey, session.uploadId);
  await upload.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
  try {
    const attachment = await db.insert(schema.attachments).values({
      id: session.attachmentId, challengeId: session.challengeId, objectKey: session.objectKey,
      filename: session.filename, contentType: session.contentType, size: session.size,
    }).returning({ id: schema.attachments.id, filename: schema.attachments.filename, contentType: schema.attachments.contentType, size: schema.attachments.size }).get();
    await db.delete(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, session.id));
    await writeAudit(c, { action: "attachment.created", targetType: "attachment", targetId: attachment.id, metadata: { filename: attachment.filename, size: attachment.size, challengeId: session.challengeId } });
    return c.json({ attachment }, 201);
  } catch (error) {
    await c.env.FILES.delete(session.objectKey);
    throw error;
  }
});

router.delete("/multipart/:id", authMiddleware, adminMiddleware, async (c) => {
  const db = getDB(c);
  const session = await db.select().from(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, c.req.param("id"))).get();
  if (!session || session.ownerId !== c.get("jwtPayload").userId) return c.json({ error: "Upload session not found" }, 404);
  try { await c.env.FILES.resumeMultipartUpload(session.objectKey, session.uploadId).abort(); } catch { /* It may already be expired by R2. */ }
  await db.delete(schema.attachmentUploads).where(eq(schema.attachmentUploads.id, session.id));
  await writeAudit(c, { action: "attachment.upload_aborted", targetType: "attachment_upload", targetId: session.id, metadata: { filename: session.filename, size: session.size } });
  return c.json({ aborted: true });
});

router.get("/challenge/:challengeId", authMiddleware, teamMiddleware, async (c) => {
  if (!c.get("jwtPayload").isAdmin && !(await eventAllowsFiles(c))) return c.json({ error: "Challenge files are not available now" }, 403);
  const challengeId = c.req.param("challengeId");
  const challenge = await getDB(c).select().from(schema.challenges).where(eq(schema.challenges.id, challengeId)).get();
  if (!challenge || (!challenge.isVisible && !c.get("jwtPayload").isAdmin)) return c.json({ error: "Challenge not found" }, 404);
  const files = await getDB(c).select({ id: schema.attachments.id, filename: schema.attachments.filename, contentType: schema.attachments.contentType, size: schema.attachments.size }).from(schema.attachments).where(eq(schema.attachments.challengeId, challengeId));
  return c.json({ attachments: files });
});

router.get("/:id/download", authMiddleware, teamMiddleware, async (c) => {
  if (!c.get("jwtPayload").isAdmin && !(await eventAllowsFiles(c))) return c.json({ error: "Challenge files are not available now" }, 403);
  const file = await getDB(c).select().from(schema.attachments).where(eq(schema.attachments.id, c.req.param("id"))).get();
  if (!file) return c.json({ error: "Attachment not found" }, 404);
  const challenge = await getDB(c).select().from(schema.challenges).where(eq(schema.challenges.id, file.challengeId)).get();
  if (!challenge || (!challenge.isVisible && !c.get("jwtPayload").isAdmin)) return c.json({ error: "Attachment not found" }, 404);
  const object = await c.env.FILES.get(file.objectKey);
  if (!object) return c.json({ error: "Attachment file is missing" }, 404);
  const safeName = encodeURIComponent(file.filename).replace(/['()*]/g, "");
  return new Response(object.body, { headers: { "Content-Type": file.contentType, "Content-Length": String(file.size), "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
});

router.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const file = await getDB(c).select().from(schema.attachments).where(eq(schema.attachments.id, c.req.param("id"))).get();
  if (!file) return c.json({ error: "Attachment not found" }, 404);
  await c.env.FILES.delete(file.objectKey);
  await getDB(c).delete(schema.attachments).where(and(eq(schema.attachments.id, file.id), eq(schema.attachments.objectKey, file.objectKey)));
  await writeAudit(c, { action: "attachment.deleted", targetType: "attachment", targetId: file.id, metadata: { filename: file.filename, size: file.size, challengeId: file.challengeId } });
  return c.json({ deleted: true });
});

export default router;
