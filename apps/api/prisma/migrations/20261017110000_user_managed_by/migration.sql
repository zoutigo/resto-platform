-- AlterTable
ALTER TABLE "User" ADD COLUMN     "managedByRestaurantId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managedByRestaurantId_fkey" FOREIGN KEY ("managedByRestaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

