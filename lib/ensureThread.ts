import { supabase } from "@/lib/supabaseClient";

/**
 * Find existing thread for (item_id, owner_id, requester_id) or create it.
 */
export async function ensureThread(params: {
  itemId: string;
  ownerId: string;
  requesterId: string;
}) {
  const { itemId, ownerId, requesterId } = params;

  const { data: existing, error: findErr } = await supabase
    .from("threads")
    .select("id")
    .eq("item_id", itemId)
    .eq("owner_id", ownerId)
    .eq("requester_id", requesterId)
    .maybeSingle();

  if (findErr) throw new Error(findErr.message);
  if (existing?.id) return existing.id as string;

  const { data: created, error: createErr } = await supabase
    .from("threads")
    .insert([{ item_id: itemId, owner_id: ownerId, requester_id: requesterId }])
    .select("id")
    .single();

  if (createErr) throw new Error(createErr.message);

  return created.id as string;
}

/**
 * "System message" = normal message row. We just write a special body.
 */
export async function insertSystemMessage(params: {
  threadId: string;
  senderId: string;
  body: string;
}) {
  const { threadId, senderId, body } = params;

  const { error } = await supabase.from("messages").insert([
    {
      thread_id: threadId,
      sender_id: senderId,
      body,
    },
  ]);

  if (error) throw new Error(error.message);
}