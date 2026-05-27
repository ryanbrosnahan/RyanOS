DROP INDEX "sessions_provider_chat_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_message_idx" ON "messages" USING btree ("provider","session_id","provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_provider_chat_idx" ON "sessions" USING btree ("provider","provider_chat_id");