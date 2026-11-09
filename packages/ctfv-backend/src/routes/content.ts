import { isUniqueConstraintError } from "../utils/sqlite-error";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { JwtVariables } from "hono/jwt";
import { getDB } from "..";
import { Bindings } from "../../env";
import * as schema from "../db/schema";
import { adminMiddleware } from "../middlewares/admin";
import { authMiddleware } from "../middlewares/auth";
import { writeAudit } from "../utils/audit";
import { readJsonRecord } from "../utils/json-input";

const router = new Hono<{ Bindings: Bindings; Variables: JwtVariables }>();

type ContentInput = { title?: string; body?: string; slug?: string; published?: boolean };

function validContent(input: Record<string, unknown> | null, page: boolean, required: boolean): input is Record<string, unknown> & ContentInput {
  if (!input) return false;
  for (const [field, limit] of [["title", 160], ["body", page ? 50000 : 20000]] as const) {
    const value = input[field];
    if (value === undefined && !required) continue;
    if (typeof value !== "string" || !value.trim() || value.length > limit) return false;
  }
  if (input.published !== undefined && typeof input.published !== "boolean") return false;
  if (page && (input.slug !== undefined || required)) {
    if (typeof input.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug.trim().toLowerCase())) return false;
  }
  return true;
}


router.get("/announcements", async (c) => {
  const rows = await getDB(c).select({ id: schema.announcements.id, title: schema.announcements.title, body: schema.announcements.body, createdAt: schema.announcements.createdAt }).from(schema.announcements).where(eq(schema.announcements.published, true)).orderBy(desc(schema.announcements.createdAt)).limit(25);
  return c.json({ announcements: rows });
});
router.get("/pages/:slug", async (c) => {
  const page = await getDB(c).select({ slug: schema.contentPages.slug, title: schema.contentPages.title, body: schema.contentPages.body, updatedAt: schema.contentPages.updatedAt }).from(schema.contentPages).where(and(eq(schema.contentPages.slug, c.req.param("slug")), eq(schema.contentPages.published, true))).get();
  return page ? c.json({ page }) : c.json({ error: "Page not found" }, 404);
});
router.get("/pages", async (c) => {
  const pages = await getDB(c).select({ slug: schema.contentPages.slug, title: schema.contentPages.title }).from(schema.contentPages).where(eq(schema.contentPages.published, true)).orderBy(schema.contentPages.title);
  return c.json({ pages });
});

router.get("/admin/announcements", authMiddleware, adminMiddleware, async (c) => c.json({ announcements: await getDB(c).select().from(schema.announcements).orderBy(desc(schema.announcements.updatedAt)) }));
router.post("/admin/announcements", authMiddleware, adminMiddleware, async (c) => {
  const input = await readJsonRecord(c.req);
  if (!validContent(input, false, true)) return c.json({ error: "Provide a nonblank title (up to 160 characters), body (up to 20000 characters), and a boolean published value" }, 400);
  if (!input.title?.trim() || !input.body?.trim()) return c.json({ error: "Title and body are required" }, 400);
  const row = await getDB(c).insert(schema.announcements).values({ title: input.title!.trim(), body: input.body!, published: input.published ?? false, updatedAt: new Date() }).returning().get();
  await writeAudit(c, { action: "announcement.created", targetType: "announcement", targetId: row.id, metadata: { title: row.title, isPublished: row.published } });
  return c.json({ announcement: row }, 201);
});
router.put("/admin/announcements/:id", authMiddleware, adminMiddleware, async (c) => {
  const input = await readJsonRecord(c.req);
  if (!validContent(input, false, false)) return c.json({ error: "Invalid announcement fields: title and body must be nonblank strings within their limits; published must be boolean" }, 400);
  const row = await getDB(c).update(schema.announcements).set({ title: input.title?.trim(), body: input.body, published: input.published, updatedAt: new Date() }).where(eq(schema.announcements.id, c.req.param("id"))).returning().get();
  if (row) await writeAudit(c, { action: "announcement.updated", targetType: "announcement", targetId: row.id, metadata: { title: row.title, isPublished: row.published } });
  return row ? c.json({ announcement: row }) : c.json({ error: "Announcement not found" }, 404);
});
router.delete("/admin/announcements/:id", authMiddleware, adminMiddleware, async (c) => {
  const row = await getDB(c).delete(schema.announcements).where(eq(schema.announcements.id, c.req.param("id"))).returning({ id: schema.announcements.id }).get();
  if (row) await writeAudit(c, { action: "announcement.deleted", targetType: "announcement", targetId: row.id });
  return row ? c.json({ deleted: true }) : c.json({ error: "Announcement not found" }, 404);
});

router.get("/admin/pages", authMiddleware, adminMiddleware, async (c) => c.json({ pages: await getDB(c).select().from(schema.contentPages).orderBy(schema.contentPages.slug) }));
router.post("/admin/pages", authMiddleware, adminMiddleware, async (c) => {
  const input = await readJsonRecord(c.req);
  if (!validContent(input, true, true)) return c.json({ error: "Provide a valid slug, nonblank title (up to 160 characters), body (up to 50000 characters), and a boolean published value" }, 400);
  const slug = input.slug?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !input.title?.trim() || !input.body?.trim()) return c.json({ error: "Use a valid slug and provide title and body" }, 400);
  try {
    const row = await getDB(c).insert(schema.contentPages).values({ slug, title: input.title!.trim(), body: input.body!, published: input.published ?? false, updatedAt: new Date() }).returning().get();
    await writeAudit(c, { action: "page.created", targetType: "page", targetId: row.id, metadata: { slug: row.slug, title: row.title, isPublished: row.published } });
    return c.json({ page: row }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error, "content_pages.slug")) return c.json({ error: "Page slug already exists" }, 409);
    throw error;
  }
});
router.put("/admin/pages/:id", authMiddleware, adminMiddleware, async (c) => {
  const input = await readJsonRecord(c.req);
  if (!validContent(input, true, false)) return c.json({ error: "Invalid page fields: use a valid slug, nonblank title and body within their limits, and boolean published" }, 400);
  const slug = input.slug?.trim().toLowerCase();
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return c.json({ error: "Invalid page slug" }, 400);
  let row;
  try {
    row = await getDB(c).update(schema.contentPages).set({ slug, title: input.title?.trim(), body: input.body, published: input.published, updatedAt: new Date() }).where(eq(schema.contentPages.id, c.req.param("id"))).returning().get();
  } catch (error) {
    if (isUniqueConstraintError(error, "content_pages.slug")) return c.json({ error: "Page slug already exists" }, 409);
    throw error;
  }
  if (row) await writeAudit(c, { action: "page.updated", targetType: "page", targetId: row.id, metadata: { slug: row.slug, title: row.title, isPublished: row.published } });
  return row ? c.json({ page: row }) : c.json({ error: "Page not found" }, 404);
});
router.delete("/admin/pages/:id", authMiddleware, adminMiddleware, async (c) => {
  const row = await getDB(c).delete(schema.contentPages).where(eq(schema.contentPages.id, c.req.param("id"))).returning({ id: schema.contentPages.id }).get();
  if (row) await writeAudit(c, { action: "page.deleted", targetType: "page", targetId: row.id });
  return row ? c.json({ deleted: true }) : c.json({ error: "Page not found" }, 404);
});

export default router;
