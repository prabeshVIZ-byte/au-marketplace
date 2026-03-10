"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type EventRow = {
  id: string
  created_by: string
  title: string
  description: string | null
  host_org: string | null
  category: string | null
  location: string | null
  starts_at: string | null
  ends_at: string | null
  link_url: string | null
  photo_url: string | null
  is_anonymous: boolean | null
}

export default function EditEventPage() {

  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const [userId,setUserId] = useState<string|null>(null)

  const [event,setEvent] = useState<EventRow|null>(null)

  const [title,setTitle] = useState("")
  const [description,setDescription] = useState("")
  const [hostOrg,setHostOrg] = useState("")
  const [category,setCategory] = useState("")
  const [location,setLocation] = useState("")
  const [startsAt,setStartsAt] = useState("")
  const [endsAt,setEndsAt] = useState("")
  const [linkUrl,setLinkUrl] = useState("")
  const [photoUrl,setPhotoUrl] = useState("")
  const [isAnonymous,setIsAnonymous] = useState(false)

  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState<string|null>(null)

  async function loadEvent() {

    setLoading(true)

    const { data,error } = await supabase
      .from("events")
      .select("*")
      .eq("id",id)
      .single()

    if(error){
      setError(error.message)
      setLoading(false)
      return
    }

    const row = data as EventRow

    setEvent(row)

    setTitle(row.title ?? "")
    setDescription(row.description ?? "")
    setHostOrg(row.host_org ?? "")
    setCategory(row.category ?? "")
    setLocation(row.location ?? "")
    setStartsAt(row.starts_at ?? "")
    setEndsAt(row.ends_at ?? "")
    setLinkUrl(row.link_url ?? "")
    setPhotoUrl(row.photo_url ?? "")
    setIsAnonymous(!!row.is_anonymous)

    setLoading(false)
  }

  async function syncAuth(){

    const { data } = await supabase.auth.getSession()
    setUserId(data.session?.user?.id ?? null)

  }

  async function saveEvent(){

    if(!event) return

    if(userId !== event.created_by){
      setError("You are not allowed to edit this event.")
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from("events")
      .update({
        title: title.trim(),
        description: description.trim(),
        host_org: hostOrg.trim(),
        category: category,
        location: location.trim(),
        starts_at: startsAt,
        ends_at: endsAt || null,
        link_url: linkUrl || null,
        photo_url: photoUrl || null,
        is_anonymous: isAnonymous
      })
      .eq("id",event.id)

    if(error){
      setError(error.message)
      setSaving(false)
      return
    }

    router.push(`/event/${event.id}`)
    router.refresh()

  }

  useEffect(()=>{

    syncAuth()
    loadEvent()

  },[id])

  if(loading){
    return <div>Loading event...</div>
  }

  if(error){
    return <div>Error: {error}</div>
  }

  return (

    <div style={{maxWidth:700,margin:"0 auto",padding:20}}>

      <h1>Edit Event</h1>

      <label>Title</label>
      <input value={title} onChange={e=>setTitle(e.target.value)} />

      <label>Description</label>
      <textarea value={description} onChange={e=>setDescription(e.target.value)} />

      <label>Host</label>
      <input value={hostOrg} onChange={e=>setHostOrg(e.target.value)} />

      <label>Category</label>
      <input value={category} onChange={e=>setCategory(e.target.value)} />

      <label>Location</label>
      <input value={location} onChange={e=>setLocation(e.target.value)} />

      <label>Start time</label>
      <input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} />

      <label>End time</label>
      <input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} />

      <label>Event link</label>
      <input value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} />

      <label>Flyer URL</label>
      <input value={photoUrl} onChange={e=>setPhotoUrl(e.target.value)} />

      <label>
        <input
          type="checkbox"
          checked={isAnonymous}
          onChange={e=>setIsAnonymous(e.target.checked)}
        />
        Post anonymously
      </label>

      <br/>

      <button onClick={saveEvent} disabled={saving}>
        {saving ? "Saving..." : "Save changes"}
      </button>

    </div>

  )
}