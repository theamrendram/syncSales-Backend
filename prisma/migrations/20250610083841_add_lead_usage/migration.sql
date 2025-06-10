-- CreateTable
CREATE TABLE "LeadUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadUsage_userId_date_key" ON "LeadUsage"("userId", "date");
