-- Ensure provider-agnostic columns exist before dropping Razorpay fields.
ALTER TABLE "Subscription"
ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT NOT NULL DEFAULT 'dodo',
ADD COLUMN IF NOT EXISTS "externalSubscriptionId" TEXT,
ADD COLUMN IF NOT EXISTS "externalPaymentId" TEXT,
ADD COLUMN IF NOT EXISTS "externalCustomerId" TEXT,
ADD COLUMN IF NOT EXISTS "nextBillingDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelAtNextBillingDate" BOOLEAN,
ADD COLUMN IF NOT EXISTS "accessEndsAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "gracePeriodEnds" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Align nullability with current schema.
ALTER TABLE "Subscription"
ALTER COLUMN "customerEmail" DROP NOT NULL;

-- Remove legacy indexes tied to Razorpay columns before dropping columns.
DROP INDEX IF EXISTS "Subscription_razorpaySubscriptionId_key";
DROP INDEX IF EXISTS "Subscription_razorpaySubscriptionId_idx";

-- Drop legacy Razorpay fields from subscriptions.
ALTER TABLE "Subscription"
DROP COLUMN IF EXISTS "razorpayPaymentId",
DROP COLUMN IF EXISTS "razorpaySubscriptionId";

-- Ensure provider-agnostic indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_externalSubscriptionId_key"
ON "Subscription"("externalSubscriptionId");

CREATE INDEX IF NOT EXISTS "Subscription_paymentProvider_externalSubscriptionId_idx"
ON "Subscription"("paymentProvider", "externalSubscriptionId");
