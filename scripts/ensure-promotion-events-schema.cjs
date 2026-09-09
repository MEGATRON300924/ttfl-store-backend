const fs=require('node:fs');
const path=require('node:path');
const schemaPath=path.join(process.cwd(),'prisma','schema.prisma');
let schema=fs.readFileSync(schemaPath,'utf8');
if(!schema.includes('model PromotionEvent {')){
  schema+='\nmodel PromotionEvent {\n id String @id\n promotionType String @map("promotion_type")\n promotionId String @map("promotion_id")\n vendorId String @map("vendor_id")\n productId String? @map("product_id")\n event String\n sessionId String? @map("session_id")\n userId String? @map("user_id")\n quantity Int?\n revenue Decimal?\n source String?\n createdAt DateTime @default(now()) @map("created_at")\n @@index([vendorId,createdAt])\n @@index([promotionId,createdAt])\n @@map("promotion_events")\n}\n';
  fs.writeFileSync(schemaPath,schema);
}
// Database creation is intentionally handled later by Prisma generation and
// the existing safe-push step. This script must remain dependency-free because
// it runs during Render schema preparation before database dependencies are used.
console.log('Promotion events Prisma model ensured.');
