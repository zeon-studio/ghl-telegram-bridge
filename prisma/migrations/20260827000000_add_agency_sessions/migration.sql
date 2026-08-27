-- CreateTable
CREATE TABLE "agency_sessions" (
    "company_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_sessions_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "agency_sessions" ENABLE ROW LEVEL SECURITY;
