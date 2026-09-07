/**
 * Backfill legacy rows so Better Auth can adopt them.
 *
 *   node scripts/backfill-better-auth.js            # dry run, prints a plan
 *   node scripts/backfill-better-auth.js --apply    # writes
 *
 * Four independent backfills, each idempotent — rerunning changes nothing:
 *
 *   1. User.name          derived from firstName + lastName. Better Auth reads
 *                         `name`; the rest of the codebase reads the other two.
 *   2. User.emailVerified set true for rows that predate the migration. These
 *                         users were already verified by the previous identity
 *                         provider, so re-verifying them would be a regression.
 *                         Only ever applied to users with no Account row — a
 *                         user who has since signed up through Better Auth owns
 *                         their own verification state and is left alone.
 *   3. Organization.slug   derived from name, deduplicated. The organization
 *                         plugin looks organizations up by slug; existing rows
 *                         migrate as NULL and would be invisible to it.
 *   4. Member             mirrored from OrganizationMember, mapping Role.name
 *                         onto the fixed names in src/lib/org-roles.js. The two
 *                         tables coexist during the transition.
 *
 * Nothing here touches Lead, Route, Campaign or LeadUsage.
 */
import "dotenv/config";
import { pathToFileURL } from "url";
import prisma from "../src/utils/prismaClient.js";
import { isKnownRole, DEFAULT_ROLE } from "../src/lib/org-roles.js";

const APPLY = process.argv.includes("--apply");

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function fullName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
}

async function backfillUserNames(plan) {
  const users = await prisma.user.findMany({
    where: { OR: [{ name: null }, { name: "" }] },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  for (const user of users) {
    const name = fullName(user) || user.email.split("@")[0];
    plan.push({
      what: "User.name",
      who: user.email,
      detail: `-> "${name}"`,
      run: () => prisma.user.update({ where: { id: user.id }, data: { name } }),
    });
  }
}

async function backfillEmailVerified(plan) {
  // Only users with no Account row: those predate Better Auth. Anyone who has
  // signed up through it already owns an accurate emailVerified value.
  const users = await prisma.user.findMany({
    where: { emailVerified: false, accounts: { none: {} } },
    select: { id: true, email: true },
  });

  for (const user of users) {
    plan.push({
      what: "User.emailVerified",
      who: user.email,
      detail: "false -> true (pre-existing, already verified upstream)",
      run: () =>
        prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        }),
    });
  }
}

async function backfillOrgSlugs(plan) {
  const orgs = await prisma.organization.findMany({
    where: { OR: [{ slug: null }, { slug: "" }] },
    select: { id: true, name: true },
  });
  if (orgs.length === 0) return;

  const taken = new Set(
    (
      await prisma.organization.findMany({
        where: { slug: { not: null } },
        select: { slug: true },
      })
    ).map((o) => o.slug),
  );

  for (const org of orgs) {
    const base = slugify(org.name) || `org-${org.id.slice(0, 8)}`;
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    taken.add(slug);

    plan.push({
      what: "Organization.slug",
      who: org.name,
      detail: `-> "${slug}"`,
      run: () =>
        prisma.organization.update({ where: { id: org.id }, data: { slug } }),
    });
  }
}

async function backfillMembers(plan) {
  const legacy = await prisma.organizationMember.findMany({
    select: {
      userId: true,
      organizationId: true,
      status: true,
      role: { select: { name: true } },
      user: { select: { email: true } },
    },
  });

  for (const m of legacy) {
    const existing = await prisma.member.findUnique({
      where: {
        userId_organizationId: {
          userId: m.userId,
          organizationId: m.organizationId,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    // Unrecognised legacy role names fall to the least-privileged role rather
    // than being invented, so a bad name can never widen access.
    const raw = m.role?.name;
    const role = isKnownRole(raw) ? raw : DEFAULT_ROLE;
    const note = raw === role ? role : `${raw ?? "<none>"} -> ${role}`;

    plan.push({
      what: "Member",
      who: `${m.user?.email ?? m.userId} @ ${m.organizationId.slice(0, 8)}`,
      detail: `role ${note}${m.status !== "active" ? ` (legacy status ${m.status})` : ""}`,
      run: () =>
        prisma.member.create({
          data: {
            userId: m.userId,
            organizationId: m.organizationId,
            role,
          },
        }),
    });
  }
}

async function main() {
  const plan = [];
  await backfillUserNames(plan);
  await backfillEmailVerified(plan);
  await backfillOrgSlugs(plan);
  await backfillMembers(plan);

  if (plan.length === 0) {
    console.log("Nothing to backfill — already consistent.");
    return;
  }

  const grouped = plan.reduce((acc, p) => {
    (acc[p.what] ||= []).push(p);
    return acc;
  }, {});

  for (const [what, items] of Object.entries(grouped)) {
    console.log(`\n${what}  (${items.length})`);
    for (const i of items) console.log(`  ${i.who}  ${i.detail}`);
  }

  if (!APPLY) {
    console.log(`\n${plan.length} change(s) planned. Re-run with --apply to write.`);
    return;
  }

  console.log(`\nApplying ${plan.length} change(s)…`);
  let ok = 0;
  for (const p of plan) {
    try {
      await p.run();
      ok += 1;
    } catch (err) {
      console.error(`  FAILED ${p.what} ${p.who}: ${err.message}`);
    }
  }
  console.log(`Applied ${ok}/${plan.length}.`);
}

if (
  import.meta.url ===
  (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")
) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

export { main as backfillBetterAuth, slugify };
