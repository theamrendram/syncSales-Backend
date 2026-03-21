-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "orgLeadId" INTEGER;

-- CreateTable
CREATE TABLE "OrgLeadCounter" (
    "organizationId" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrgLeadCounter_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_organizationId_orgLeadId_key" ON "Lead"("organizationId", "orgLeadId");

-- AddForeignKey
ALTER TABLE "OrgLeadCounter" ADD CONSTRAINT "OrgLeadCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
