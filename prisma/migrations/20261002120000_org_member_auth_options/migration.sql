-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "allowMemberPasswordManagement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowMemberSocialLinking" BOOLEAN NOT NULL DEFAULT false;
