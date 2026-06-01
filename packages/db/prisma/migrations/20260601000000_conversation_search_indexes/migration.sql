-- M3.3 full-text conversation search.
--
-- Expression GIN indexes backing ConversationService.search, which matches the `'simple'`-config
-- to_tsvector of each message's content and of each conversation's title against a
-- websearch_to_tsquery. The index expressions must match the query expressions verbatim to be used.
-- `to_tsvector('simple', …)` resolves to the IMMUTABLE `to_tsvector(regconfig, text)` form (the
-- `'simple'` literal is a constant regconfig), so both expressions are indexable.

CREATE INDEX "messages_content_fts_idx"
  ON "messages" USING gin (to_tsvector('simple', content));

CREATE INDEX "conversations_title_fts_idx"
  ON "conversations" USING gin (to_tsvector('simple', coalesce(title, '')));
