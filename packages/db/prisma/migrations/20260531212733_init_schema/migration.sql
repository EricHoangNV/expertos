-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "content_scope" AS ENUM ('global_expert', 'shared_expert', 'tenant_customer', 'user_private', 'temporary_upload');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('user', 'expert', 'admin');

-- CreateEnum
CREATE TYPE "language" AS ENUM ('en', 'vi');

-- CreateEnum
CREATE TYPE "publish_status" AS ENUM ('draft', 'ai_processing', 'expert_review', 'published', 'archived');

-- CreateEnum
CREATE TYPE "chunk_status" AS ENUM ('pending', 'published', 'archived');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "billing_interval" AS ENUM ('month', 'year');

-- CreateEnum
CREATE TYPE "feature_type" AS ENUM ('boolean', 'metered');

-- CreateEnum
CREATE TYPE "usage_window" AS ENUM ('day', 'week', 'month');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('subscription', 'one_off', 'refund', 'adjustment');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "upload_mode" AS ENUM ('temporary', 'persistent');

-- CreateEnum
CREATE TYPE "review_trigger_mode" AS ENUM ('user_prompted', 'auto_silent');

-- CreateEnum
CREATE TYPE "review_visibility" AS ENUM ('visible', 'silent');

-- CreateEnum
CREATE TYPE "review_request_status" AS ENUM ('requested', 'in_review', 'answered', 'escalated', 'dismissed');

-- CreateEnum
CREATE TYPE "review_verdict" AS ENUM ('good', 'bad', 'great');

-- CreateEnum
CREATE TYPE "knowledge_draft_status" AS ENUM ('draft', 'expert_review', 'published', 'rejected');

-- CreateEnum
CREATE TYPE "consultation_status" AS ENUM ('recommended', 'booked', 'confirmed', 'completed', 'canceled', 'no_show');

-- CreateEnum
CREATE TYPE "recommendation_trigger" AS ENUM ('topic', 'depth', 'low_confidence', 'high_intent');

-- CreateEnum
CREATE TYPE "recommendation_response" AS ENUM ('pending', 'book', 'maybe_later', 'ask_another');

-- CreateEnum
CREATE TYPE "data_deletion_status" AS ENUM ('requested', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "fair_use_flag_status" AS ENUM ('open', 'reviewed', 'throttled', 'cleared');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "firebase_uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "role" NOT NULL DEFAULT 'user',
    "locale" "language" NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "expert_id" UUID NOT NULL,
    "language" "language" NOT NULL DEFAULT 'en',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "guidelines" TEXT,
    "status" "publish_status" NOT NULL DEFAULT 'draft',
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_examples" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "voice_profile_id" UUID NOT NULL,
    "prompt" TEXT,
    "content" TEXT NOT NULL,
    "language" "language" NOT NULL DEFAULT 'en',
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "interval" "billing_interval" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "provider_price_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "feature_type" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlements" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "feature_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit" INTEGER,
    "window" "usage_window",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "interval" "billing_interval" NOT NULL DEFAULT 'month',
    "status" "subscription_status" NOT NULL DEFAULT 'active',
    "provider_customer_id" TEXT,
    "provider_subscription_id" TEXT,
    "current_period_end" TIMESTAMP(3),
    "cancel_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "window" "usage_window" NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID,
    "feature_key" TEXT NOT NULL,
    "model" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "cost_micros" INTEGER,
    "conversation_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "type" "transaction_type" NOT NULL,
    "status" "transaction_status" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "provider_ref" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "scope" "content_scope" NOT NULL DEFAULT 'global_expert',
    "expert_id" UUID,
    "title" TEXT NOT NULL,
    "source_uri" TEXT,
    "language" "language" NOT NULL DEFAULT 'en',
    "status" "publish_status" NOT NULL DEFAULT 'draft',
    "published_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "publish_status" NOT NULL DEFAULT 'draft',
    "change_summary" TEXT,
    "content_uri" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "scope" "content_scope" NOT NULL DEFAULT 'global_expert',
    "document_version_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "language" "language" NOT NULL DEFAULT 'en',
    "status" "chunk_status" NOT NULL DEFAULT 'pending',
    "token_count" INTEGER,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "message_id" UUID NOT NULL,
    "chunk_id" UUID,
    "document_version_id" UUID,
    "upload_chunk_id" UUID,
    "ordinal" INTEGER NOT NULL,
    "quote" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_topics" (
    "document_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,

    CONSTRAINT "document_topics_pkey" PRIMARY KEY ("document_id","topic_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "expert_id" UUID,
    "title" TEXT,
    "language" "language" NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "conversation_id" UUID NOT NULL,
    "role" "message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "source_version_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "model" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_answers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_feedback" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_drafts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "conversation_id" UUID,
    "expert_id" UUID,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "knowledge_draft_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "human_review_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "assignee_id" UUID,
    "trigger_mode" "review_trigger_mode" NOT NULL,
    "visibility" "review_visibility" NOT NULL DEFAULT 'visible',
    "confidence_score" DOUBLE PRECISION,
    "status" "review_request_status" NOT NULL DEFAULT 'requested',
    "sla_due_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "human_review_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "review_request_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "verdict" "review_verdict" NOT NULL,
    "original_answer" TEXT NOT NULL,
    "revised_answer" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "delivered_to_user" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "scope" "content_scope" NOT NULL DEFAULT 'temporary_upload',
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "gcs_uri" TEXT,
    "mode" "upload_mode" NOT NULL DEFAULT 'temporary',
    "retention_days" INTEGER,
    "scanned" BOOLEAN NOT NULL DEFAULT false,
    "scan_clean" BOOLEAN,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_chunks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "scope" "content_scope" NOT NULL DEFAULT 'temporary_upload',
    "uploaded_file_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sheet_name" TEXT,
    "cell_ref" TEXT,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_types" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price_cents" INTEGER,
    "tidycal_link" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "type_id" UUID,
    "status" "consultation_status" NOT NULL DEFAULT 'recommended',
    "booking_ref" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "amount_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_recommendations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "consultation_id" UUID,
    "trigger" "recommendation_trigger" NOT NULL,
    "response" "recommendation_response" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "consultation_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_cache" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "normalized_question" TEXT NOT NULL,
    "embedding" vector(1536),
    "chunk_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "answer" TEXT NOT NULL,
    "citation_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "model" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semantic_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "status" "data_deletion_status" NOT NULL DEFAULT 'requested',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fair_use_flags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "fair_use_flag_status" NOT NULL DEFAULT 'open',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fair_use_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "experts_user_id_key" ON "experts"("user_id");

-- CreateIndex
CREATE INDEX "experts_tenant_id_idx" ON "experts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "experts_tenant_id_slug_key" ON "experts"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "voice_profiles_tenant_id_expert_id_language_idx" ON "voice_profiles"("tenant_id", "expert_id", "language");

-- CreateIndex
CREATE INDEX "voice_examples_tenant_id_voice_profile_id_idx" ON "voice_examples"("tenant_id", "voice_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_plan_id_interval_key" ON "plan_prices"("plan_id", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "features"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entitlements_plan_id_feature_id_key" ON "plan_entitlements"("plan_id", "feature_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_user_id_idx" ON "subscriptions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "usage_counters_tenant_id_user_id_idx" ON "usage_counters"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_user_id_feature_key_window_window_start_key" ON "usage_counters"("user_id", "feature_key", "window", "window_start");

-- CreateIndex
CREATE INDEX "usage_logs_tenant_id_user_id_idx" ON "usage_logs"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "usage_logs_occurred_at_idx" ON "usage_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "transactions_tenant_id_user_id_idx" ON "transactions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "transactions_occurred_at_idx" ON "transactions"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_provider_provider_ref_key" ON "transactions"("provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "documents_published_version_id_key" ON "documents"("published_version_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_scope_status_idx" ON "documents"("tenant_id", "scope", "status");

-- CreateIndex
CREATE INDEX "document_versions_tenant_id_idx" ON "document_versions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "chunks_tenant_id_scope_status_language_idx" ON "chunks"("tenant_id", "scope", "status", "language");

-- CreateIndex
CREATE UNIQUE INDEX "chunks_document_version_id_chunk_index_key" ON "chunks"("document_version_id", "chunk_index");

-- CreateIndex
CREATE INDEX "citations_tenant_id_message_id_idx" ON "citations"("tenant_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_tenant_id_slug_key" ON "topics"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_user_id_idx" ON "conversations"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_idx" ON "messages"("tenant_id", "conversation_id");

-- CreateIndex
CREATE INDEX "saved_answers_tenant_id_user_id_idx" ON "saved_answers"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_answers_user_id_message_id_key" ON "saved_answers"("user_id", "message_id");

-- CreateIndex
CREATE INDEX "answer_feedback_tenant_id_message_id_idx" ON "answer_feedback"("tenant_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "answer_feedback_user_id_message_id_key" ON "answer_feedback"("user_id", "message_id");

-- CreateIndex
CREATE INDEX "knowledge_drafts_tenant_id_status_idx" ON "knowledge_drafts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "human_review_requests_tenant_id_status_idx" ON "human_review_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "human_review_requests_assignee_id_idx" ON "human_review_requests"("assignee_id");

-- CreateIndex
CREATE INDEX "review_responses_tenant_id_review_request_id_idx" ON "review_responses"("tenant_id", "review_request_id");

-- CreateIndex
CREATE INDEX "uploaded_files_tenant_id_user_id_idx" ON "uploaded_files"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "upload_chunks_tenant_id_uploaded_file_id_idx" ON "upload_chunks"("tenant_id", "uploaded_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "upload_chunks_uploaded_file_id_chunk_index_key" ON "upload_chunks"("uploaded_file_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_types_key_key" ON "consultation_types"("key");

-- CreateIndex
CREATE INDEX "consultations_tenant_id_user_id_idx" ON "consultations"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "consultations_status_idx" ON "consultations"("status");

-- CreateIndex
CREATE INDEX "consultation_recommendations_tenant_id_user_id_idx" ON "consultation_recommendations"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "consultation_notes_tenant_id_consultation_id_idx" ON "consultation_notes"("tenant_id", "consultation_id");

-- CreateIndex
CREATE INDEX "semantic_cache_tenant_id_idx" ON "semantic_cache"("tenant_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_tenant_id_created_at_idx" ON "admin_audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "data_deletion_requests_tenant_id_status_idx" ON "data_deletion_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "fair_use_flags_tenant_id_status_idx" ON "fair_use_flags"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experts" ADD CONSTRAINT "experts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experts" ADD CONSTRAINT "experts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "experts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_examples" ADD CONSTRAINT "voice_examples_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_examples" ADD CONSTRAINT "voice_examples_voice_profile_id_fkey" FOREIGN KEY ("voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "experts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_upload_chunk_id_fkey" FOREIGN KEY ("upload_chunk_id") REFERENCES "upload_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_topics" ADD CONSTRAINT "document_topics_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_topics" ADD CONSTRAINT "document_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_answers" ADD CONSTRAINT "saved_answers_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_drafts" ADD CONSTRAINT "knowledge_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_drafts" ADD CONSTRAINT "knowledge_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_review_requests" ADD CONSTRAINT "human_review_requests_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_review_request_id_fkey" FOREIGN KEY ("review_request_id") REFERENCES "human_review_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_uploaded_file_id_fkey" FOREIGN KEY ("uploaded_file_id") REFERENCES "uploaded_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "consultation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_recommendations" ADD CONSTRAINT "consultation_recommendations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_recommendations" ADD CONSTRAINT "consultation_recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_recommendations" ADD CONSTRAINT "consultation_recommendations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_recommendations" ADD CONSTRAINT "consultation_recommendations_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_cache" ADD CONSTRAINT "semantic_cache_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fair_use_flags" ADD CONSTRAINT "fair_use_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fair_use_flags" ADD CONSTRAINT "fair_use_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

