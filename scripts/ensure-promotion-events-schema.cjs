const fs=require('node:fs');
const path=require('node:path');
const schemaPath=path.join(process.cwd(),'prisma','schema.prisma');
let schema=fs.readFileSync(schemaPath,'utf8');
if(!schema.includes('model PromotionEvent {')){
  schema+='\nmodel PromotionEvent {\n id String @id\n promotionType String @map("promotion_type")\n promotionId String @map("promotion_id")\n vendorId String @map("vendor_id")\n productId String? @map("product_id")\n event String\n sessionId String? @map("session_id")\n userId String? @map("user_id")\n quantity Int?\n revenue Decimal?\n source String?\n createdAt DateTime @default(now()) @map("created_at")\n @@index([vendorId,createdAt])\n @@index([promotionId,createdAt])\n @@map("promotion_events")\n}\n';
  fs.writeFileSync(schemaPath,schema);
}
// The Render build only installs production dependencies. Keep this schema
// preparation script dependency-free so it can run before Prisma generation.
if(process.env.DATABASE_URL){
  const {execFileSync}=require('node:child_process');
  const sql="CREATE TABLE IF NOT EXISTS promotion_events (id TEXT PRIMARY KEY,promotion_type TEXT NOT NULL,promotion_id TEXT NOT NULL,vendor_id TEXT NOT NULL,product_id TEXT,event TEXT NOT NULL,session_id TEXT,user_id TEXT,quantity INTEGER,revenue DECIMAL(14,2),source TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS promotion_events_vendor_created_idx ON promotion_events(vendor_id,created_at);CREATE INDEX IF NOT EXISTS promotion_events_promotion_created_idx ON promotion_events(promotion_id,created_at);";
  try{
    execFileSync('npx',['--yes','prisma','db','execute','--stdin'],{input:sql,stdio:['pipe','inherit','inherit'],env:process.env});
  }catch(error){
    console.error('Promotion events database preparation failed:',error);
    process.exit(1);
  }
}
