import { useEffect, useMemo, useRef, useState } from "react";



export default function Home() {
  const API_BASE = useMemo(
  () => (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, ""),
  []
);


  // ---- Interview state ----
  const [sessionId, setSessionId] = useState("");
  const [prevSessionId, setPrevSessionId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [decision, setDecision] = useState("");
  const [section, setSection] = useState("");
  const [turn, setTurn] = useState(null);
  const [reflection, setReflection] = useState("");
  // ---- Voice interview state ----
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  // ---- Story/approval/photo state ----
  const [storyDraft, setStoryDraft] = useState("");
  const [storyDraftVersion, setStoryDraftVersion] = useState(null);
  const [approvalStatus, setApprovalStatus] = useState("");
  const [editedText, setEditedText] = useState("");
  const [approvedText, setApprovedText] = useState("");
  const [photoStatus, setPhotoStatus] = useState("");
  const [photoObject, setPhotoObject] = useState("");
  const [photoConsentPdf, setPhotoConsentPdf] = useState(true);
  const [photoConsentPublish, setPhotoConsentPublish] = useState(false);

  // Signed upload (photo)
  const [photoUploadUrl, setPhotoUploadUrl] = useState("");
  const [photoUploadObjectName, setPhotoUploadObjectName] = useState("");
  const [photoFile, setPhotoFile] = useState(null);

  // Publish preview
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [finalStoryText, setFinalStoryText] = useState("");

  // ✅ NEW: makes preview reliably “pop up” when loaded
  const [publishPreviewLoaded, setPublishPreviewLoaded] = useState(false);

  // ---- UX ----
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Auto-generate a sessionId if empty
  useEffect(() => {
    if (!sessionId) setSessionId(`UI_TEST_${Date.now()}`);
  }, [sessionId]);

  // ✅ NEW: if session changes, don’t show old preview
  useEffect(() => {
    if (!sessionId) return;

    // Only clear preview if switching from one REAL session to another
    if (prevSessionId && prevSessionId !== sessionId) {
      setPublishPreviewLoaded(false);
      setPhotoPreviewUrl("");
      setFinalStoryText("");
    }

    setPrevSessionId(sessionId);
  }, [sessionId, prevSessionId]);


  function resetMessages() {
    setError("");
    setMsg("");
  }

  function requireBaseAndSession() {
    if (!API_BASE) throw new Error("Missing NEXT_PUBLIC_API_BASE in .env.local");
    if (!sessionId) throw new Error("Missing sessionId");
  }

  // ----------------------------
  // Interview endpoints
  // ----------------------------
  async function startInterview() {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/start-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Start failed (${res.status})`);

      setStatus(data.status || "in_progress");
      setSection(data.current_section || "Background");
      setTurn(data.turn ?? 1);
      setQuestion(data.question_text || "");
      setDecision("");
      setReflection("");
      setAnswer("");

      setMsg("Interview started. Answer the question below.");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }


  async function postAnswer(payload) {
    const res = await fetch(`${API_BASE}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Answer failed (${res.status})`);

    setStatus(data.status || "in_progress");
    setDecision(data.decision || "");
    setSection(data.current_section || section);
    setTurn(data.turn ?? turn);
    setReflection(data.agent_reflection || "");
    setQuestion(data.next_question || "");

    setMsg("Answer saved.");
    return data;
  }


  async function submitAnswer() {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, answer_text: answer }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Answer failed (${res.status})`);

      setStatus(data.status || "in_progress");
      setDecision(data.decision || "");
      setSection(data.current_section || section);
      setTurn(data.turn ?? turn);
      setReflection(data.agent_reflection || "");

      setQuestion(data.next_question || "");
      setAnswer("");
      setMsg("Answer saved.");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }


  async function startRecording() {
    resetMessages();
    setError("");
    setTranscript("");
    setRecordedBlob(null);

    // Must be HTTPS + user permission
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // WebM/Opus is the best match for typical GCP Speech settings
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    mediaRecorderRef.current = mr;
    chunksRef.current = [];

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      setRecordedBlob(blob);

      // stop mic
      stream.getTracks().forEach((t) => t.stop());
    };

    mr.start();
    setIsRecording(true);
    setMsg("Recording… click Stop when done.");
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.stop();
    setIsRecording(false);
    setMsg("Recording stopped. Click “Upload + Transcribe + Submit”.");
  }



async function submitVoiceTranscript(transcriptText) {
  resetMessages();
  setLoading(true);
  try {
    requireBaseAndSession();

    const res = await fetch(`${API_BASE}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, transcript_text: transcriptText }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Answer failed (${res.status})`);

    setStatus(data.status || "in_progress");
    setDecision(data.decision || "");
    setSection(data.current_section || section);
    setTurn(data.turn ?? turn);
    setReflection(data.agent_reflection || "");

    setQuestion(data.next_question || "");
    setMsg("Voice answer saved.");
  } catch (e) {
    setError(String(e.message || e));
  } finally {
    setLoading(false);
  }
}

async function uploadTranscribeAndSubmitVoice() {
  resetMessages();
  setLoading(true);

  try {
    requireBaseAndSession();
    if (!recordedBlob) throw new Error("No recording yet. Record audio first.");
    if (turn == null) throw new Error("Turn is not set yet. Start Interview first.");

    console.log("VOICE flow", {
      API_BASE,
      sessionId,
      turn,
      blobType: recordedBlob.type,
      blobSize: recordedBlob.size,
    });

    // 1) Get signed PUT URL for audio
    console.log("FETCH upload-url");
    const upRes = await fetch(`${API_BASE}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, turn }),
    });

    const upData = await upRes.json().catch(() => ({}));
    if (!upRes.ok) {
      throw new Error(upData?.error || `upload-url failed (${upRes.status})`);
    }
    if (!upData.upload_url) throw new Error("upload-url did not return upload_url");

    // 2) PUT audio bytes to GCS
    const contentType = recordedBlob.type || "audio/webm";
    console.log("FETCH PUT to GCS");
    const putRes = await fetch(upData.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: recordedBlob,
    });

    if (!putRes.ok) {
      const t = await putRes.text().catch(() => "");
      throw new Error(`Audio PUT failed (${putRes.status}): ${t}`);
    }

    const res = await fetch(`${API_BASE}/submit-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        turn
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `submit-turn failed (${res.status})`);

    // Update UI
    setStatus(data.status || "in_progress");
    setDecision(data.decision || "");
    setSection(data.current_section || section);
    setTurn(data.turn ?? turn);
    setReflection(data.agent_reflection || "");
    setQuestion(data.next_question || "");
    setMsg("Voice answer submitted.");

    // Reset buffers
    setRecordedBlob(null);
    setAnswer("");
    setMsg("Voice answer submitted.");
  } catch (e) {
    setError(String(e.message || e));
  } finally {
    setLoading(false);
  }
}

  async function finishInterview() {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `finish failed (${res.status})`);

      setStatus(data.status || "complete");
      setDecision("finished");
      setMsg("Interview finished. Next: Generate Draft.");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------
  // Session refresh (/story)
  // ----------------------------
  async function refreshSession(opts = { quiet: false }) {
    if (!opts?.quiet) resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/story?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `story failed (${res.status})`);

      setStatus(data.status || "in_progress");
      setApprovalStatus(data.approval_status || "");
      setStoryDraft(data.story_draft || "");
      setEditedText(data.edited_story_text || editedText);
      setApprovedText(data.approved_story_text || "");
      setPhotoStatus(data.photo_status || "");
      setPhotoObject(data.photo_object || "");
      setPhotoConsentPdf(Boolean(data.photo_consent_pdf));
      setPhotoConsentPublish(Boolean(data.photo_consent_publish));

      if (!opts?.quiet) setMsg("Session refreshed from backend.");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------
  // Draft → Edit → Approve flow
  // ----------------------------
  async function generateDraft() {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/compile-story`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `compile-story failed (${res.status})`);

      const draft = data.story_draft || "";
      setStoryDraft(draft);
      setApprovalStatus(data.approval_status || "needs_review");
      if (data.story_draft_version !== undefined && data.story_draft_version !== null) {
        setStoryDraftVersion(data.story_draft_version);
      }

      // Always load draft into the editor
      setEditedText(draft);

      // ✅ NEW: draft generation invalidates any previous publish preview
      setPublishPreviewLoaded(false);
      setPhotoPreviewUrl("");
      setFinalStoryText("");

      setMsg("Draft generated and loaded into the editor. Edit it, then Save Edits (optional), then Approve & Lock.");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function saveEdits() {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();
      if (!editedText.trim()) throw new Error("Editor is empty. Generate draft first (or paste text).");

      const res = await fetch(`${API_BASE}/edit-story`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, edited_story_text: editedText }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `edit-story failed (${res.status})`);

      setApprovalStatus(data.approval_status || "needs_review");

      // ✅ NEW: edits change what will be published → require preview reload
      setPublishPreviewLoaded(false);

      setMsg("Edits saved. Now click Approve & Lock.");
      await refreshSession({ quiet: true });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function approveStory(wantPhoto) {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/approve-story`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          want_photo: wantPhoto,
          photo_consent_pdf: photoConsentPdf,
          photo_consent_publish: photoConsentPublish,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `approve-story failed (${res.status})`);

      setApprovalStatus(data.approval_status || "approved");
      setPhotoStatus(data.photo_status || (wantPhoto ? "requested" : "skipped"));

      // ✅ NEW: approval changes the “final” text selection → reload preview
      setPublishPreviewLoaded(false);
      setPhotoPreviewUrl("");
      setFinalStoryText("");

      setMsg(wantPhoto ? "Approved and locked. Next: upload photo (optional)." : "Approved and locked. Photo skipped.");

      await refreshSession({ quiet: true });

      // If photo skipped, we can still show publish preview (story-only) immediately
      if (!wantPhoto) {
        await loadPublishPreview();
      }

      // If photo already uploaded earlier (edge case), load preview now
      if ((data.photo_status || "").toLowerCase() === "uploaded") {
        await loadPublishPreview();
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------
  // Photo flow
  // ----------------------------
  async function getPhotoUploadUrl() {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/photo-upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `photo-upload-url failed (${res.status})`);

      setPhotoUploadUrl(data.upload_url || "");
      setPhotoUploadObjectName(data.object_name || "");
      setMsg("Photo upload URL created. Choose a JPG and upload.");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function uploadPhotoAndSubmit() {
    resetMessages();
    setLoading(true);
    try {
      if (!photoFile) throw new Error("Please choose a JPG file first.");
      if (!photoUploadUrl) throw new Error("Missing upload URL. Click “Get Photo Upload URL” first.");

      // 1) PUT bytes to signed URL
      const putRes = await fetch(photoUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: photoFile,
      });

      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`Photo PUT failed (${putRes.status}): ${t}`);
      }

      // 2) Confirm with backend
      const res = await fetch(`${API_BASE}/submit-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          photo_object: photoUploadObjectName || `photos/${sessionId}/profile.jpg`,
          photo_consent_pdf: photoConsentPdf,
          photo_consent_publish: photoConsentPublish,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `submit-photo failed (${res.status})`);

      setPhotoStatus(data.photo_status || "uploaded");
      setPhotoObject(data.photo_object || "");
      setMsg("Photo uploaded and saved. Loading publish preview…");

      await loadPublishPreview();
      await refreshSession({ quiet: true });

    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function skipPhoto() {
    resetMessages();
    setLoading(true);
    try {
      requireBaseAndSession();

      const res = await fetch(`${API_BASE}/skip-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `skip-photo failed (${res.status})`);

      setPhotoStatus(data.photo_status || "skipped");
      setMsg("Photo skipped.");
      setPhotoPreviewUrl("");

      await refreshSession({ quiet: true });

      // ✅ NEW: show story-only publish preview after skip
      await loadPublishPreview();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------
  // Publish preview: photo + final story text
  // ----------------------------

 // ----------------------------
// Publish preview
// ----------------------------
// ----------------------------
// Publish preview
// ----------------------------

async function loadPublishPreview(opts = {}) {
  const allowNoPhoto = !!opts.allowNoPhoto;

  // Snapshot values at call time (prevents “stale closure” confusion in logs)
  const sid = sessionId;
  const base = API_BASE;

  console.log("CLICK: loadPublishPreview called", {
    sessionId: sid,
    API_BASE: base,
    loading,
    approvalStatus,
    photoStatus,
    allowNoPhoto,
  });

  setLoading(true);                 // ✅ IMPORTANT: paired with finally
  setError("");
  setMsg("Loading publish preview…");
  setPublishPreviewLoaded(false);

  try {
    requireBaseAndSession();
    console.log("PASS: requireBaseAndSession OK");

    // 1) Fetch story
    const storyUrl = `${base}/story?session_id=${encodeURIComponent(sid)}`;
    console.log("FETCH: story", storyUrl);

    const storyRes = await fetch(storyUrl, { method: "GET" });
    console.log("RESP: story", storyRes.status);

    const storyData = await storyRes.json().catch(() => ({}));
    if (!storyRes.ok) {
      throw new Error(storyData?.error || `story fetch failed (${storyRes.status})`);
    }

    // Update state from backend
    const nextApprovalStatus = storyData.approval_status ?? approvalStatus;
    const nextPhotoStatus = storyData.photo_status ?? photoStatus;
    const nextApprovedText = storyData.approved_story_text ?? approvedText;

    setApprovalStatus(nextApprovalStatus);
    setPhotoStatus(nextPhotoStatus);
    setApprovedText(nextApprovedText);

    const best =
      String(storyData.approved_story_text || "").trim() ||
      String(storyData.edited_story_text || "").trim() ||
      String(storyData.story_draft || "").trim();

    setFinalStoryText(best);

    // 2) Photo preview URL only if photo uploaded
    const ps = String(nextPhotoStatus || "").trim().toLowerCase();
    console.log("STATE: photo_status", ps);

    if (ps === "uploaded") {
      const previewUrl = `${base}/photo-preview-url`;
      console.log("FETCH: photo-preview-url", previewUrl);

      const res = await fetch(previewUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
      });
      console.log("RESP: photo-preview-url", res.status);

      const previewData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(previewData?.error || `photo-preview-url failed (${res.status})`);
      }

      const url = previewData.preview_url || previewData.view_url || "";
      setPhotoPreviewUrl(url);
      console.log("OK: photo preview url length", url.length);
    } else {
      setPhotoPreviewUrl("");
      if (!allowNoPhoto) {
        // story-only preview is fine; no extra action
      }
    }

    setMsg("Publish preview loaded.");
    setPublishPreviewLoaded(true);
    console.log("DONE: publish preview loaded");
  } catch (e) {
    console.error("ERR: loadPublishPreview", e);
    setError(String(e?.message || e));
    setPublishPreviewLoaded(false);
  } finally {
    setLoading(false);              // ✅ Guarantees button re-enables
  }
}

  // ----------------------------
  // Quick demo content for UI testing
  // ----------------------------
  function quickFillDemoDraft() {
    const demo = [
      "Valued for My Experience",
      "",
      "My name is Ana Martinez, and I worked as a pharmacy technician before returning to college.",
      "",
      "My pharmacy technician training program and hands-on work experience were recognized for Credit for Prior Learning (CPL) by San Diego Mesa College.",
      "",
      "I received about 6 units through CPL.",
      "",
      "I’m working toward a certificate, and CPL helped me finish sooner and qualify to apply for a higher-paying role in healthcare.",
      "",
      "Impact: CPL saved me time and money and made me feel valued for my experience.",
    ].join("\n");

    setEditedText(demo);
    setMsg("Demo draft inserted into editor. Click Save Edits (optional) → Approve & Lock.");
  }

  // ----------------------------
  // UI helpers / flags
  // ----------------------------
  const canSubmitAnswer = !!sessionId && !!question && !!answer.trim() && !loading;

  const showStoryPanel =
    status === "complete" ||
    status === "needs_review" ||
    !!storyDraft ||
    !!editedText ||
    !!approvedText ||
    !!approvalStatus;

  // Photo panel appears after approval (or if photo state indicates stage)
  const showPhotoPanel =
    approvalStatus === "approved" ||
    !!approvedText ||
    ["requested", "uploaded", "skipped"].includes((photoStatus || "").toLowerCase());

  // ✅ NEW: show preview based on “loaded” instead of only derived status timing
  const shouldShowPublishPreview =
    publishPreviewLoaded &&
    (
      String(approvalStatus || "").trim().toLowerCase() === "approved" ||
      String(approvedText || "").trim().length > 0 ||
      String(finalStoryText || "").trim().length > 0
    );

  const canGenerateDraft = !!sessionId && !loading;
  const canSaveEdits = !!sessionId && !!editedText.trim() && !loading;

  const canApprove =
    !!sessionId &&
    !loading &&
    (!!editedText.trim() || !!storyDraft.trim());

  return (
    <div style={{ maxWidth: 980, margin: "30px auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>CPL Story Interview</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ minWidth: 90 }}>Session ID</label>
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          style={{ flex: 1, minWidth: 280, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
        <button
          onClick={startInterview}
          disabled={loading || !sessionId}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
        >
          Start Interview
        </button>
        <button
          onClick={() => refreshSession()}
          disabled={loading || !sessionId}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
        >
          Refresh Session
        </button>
      </div>

      <div style={{ marginBottom: 12, color: "#444" }}>
        <strong>Status:</strong> {status || "-"}{" "}
        <span style={{ marginLeft: 12 }}><strong>Section:</strong> {section || "-"}</span>{" "}
        <span style={{ marginLeft: 12 }}><strong>Turn:</strong> {turn ?? "-"}</span>{" "}
        <span style={{ marginLeft: 12 }}><strong>Decision:</strong> {decision || "-"}</span>
      </div>

      {error ? (
        <div style={{ padding: 12, background: "#ffe8e8", border: "1px solid #ffb3b3", borderRadius: 8, marginBottom: 16 }}>
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      {msg ? (
        <div style={{ padding: 12, background: "#eef7ee", border: "1px solid #cde9cd", borderRadius: 8, marginBottom: 16 }}>
          {msg}
        </div>
      ) : null}

      {/* Interview panel */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Interview</h2>

        <div style={{ padding: 14, border: "1px solid #eee", borderRadius: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Question</div>
          <div style={{ fontSize: 18, lineHeight: 1.4 }}>
            {question || "Click “Start Interview” to fetch the first question."}
          </div>
        </div>

        {reflection ? (
          <div style={{ padding: 12, background: "#f5f5f5", border: "1px solid #e5e5e5", borderRadius: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Agent reflection</div>
            <div>{reflection}</div>
          </div>
        ) : null}

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Student Answer</div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            style={{ width: "100%", padding: 12, border: "1px solid #ccc", borderRadius: 10 }}
            placeholder="Type the student’s answer here…"
          />
        </div>

<div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
  <button
    onClick={submitAnswer}
    disabled={loading || !answer.trim()}
    style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
  >
    Submit Answer (Typed)
  </button>

  <button
    onClick={startRecording}
    disabled={loading || !sessionId || !question || isRecording}
    style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
  >
    🎙 Start Recording
  </button>

  <button
    onClick={stopRecording}
    disabled={!isRecording}
    style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
  >
    ⏹ Stop
  </button>

  <button
    onClick={uploadTranscribeAndSubmitVoice}
    disabled={loading || !recordedBlob || turn == null}
    style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
  >
    ⬆️ Upload + Transcribe + Submit (Voice)
  </button>

  <button
    onClick={finishInterview}
    disabled={loading}
    style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
  >
    Finish Interview
  </button>
</div>


{/* 👇 Recording indicator goes HERE */}
{isRecording && (
  <div style={{ marginTop: 8, color: "#c00", fontWeight: "bold" }}>
    ● Recording…
  </div>
)}


{/* 👇 Transcript goes RIGHT HERE */}
{transcript ? (
  <div
    style={{
      marginTop: 10,
      padding: 10,
      border: "1px solid #ddd",
      borderRadius: 8,
      background: "#fafafa",
    }}
  >
    <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
      Transcript (from voice)
    </div>
    <div style={{ whiteSpace: "pre-wrap" }}>{transcript}</div>
  </div>
) : null}

      </div>

      {/* Story panel */}
      {showStoryPanel && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Draft → Student Edit → Approve & Lock → Photo (Optional)</h2>

          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={generateDraft}
              disabled={!canGenerateDraft}
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Generate Draft
            </button>

            <button
              onClick={quickFillDemoDraft}
              disabled={loading}
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Quick Fill Demo Draft
            </button>

            <button
              onClick={saveEdits}
              disabled={!canSaveEdits}
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Save Edits
            </button>

            <button
              onClick={() => approveStory(true)}
              disabled={!canApprove}
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Approve & Lock (then photo)
            </button>

            <button
              onClick={() => approveStory(false)}
              disabled={!canApprove}
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Approve & Lock (skip photo)
            </button>

            <button
              onClick={() => loadPublishPreview()}
              disabled={loading || !sessionId}
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Load Publish Preview
            </button>
          </div>

          <div style={{ marginBottom: 10, color: "#444" }}>
            <strong>Approval:</strong> {approvalStatus || "-"}{" "}
            <span style={{ marginLeft: 12 }}><strong>Photo status:</strong> {photoStatus || "-"}</span>{" "}
            <span style={{ marginLeft: 12 }}><strong>Draft version:</strong> {storyDraftVersion ?? "-"}</span>
          </div>

          {/* Editor */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
              Student Editor (AI draft loads here after “Generate Draft”)
            </div>
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={12}
              style={{ width: "100%", padding: 12, border: "1px solid #ccc", borderRadius: 10 }}
              placeholder="Click “Generate Draft”, or use “Quick Fill Demo Draft”…"
            />
          </div>

          {/* Approved (locked) preview */}
          {approvedText ? (
            <div style={{ padding: 12, background: "#f5fbff", border: "1px solid #d8efff", borderRadius: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Approved Story (locked)</div>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{approvedText}</pre>
            </div>
          ) : null}

          {/* Photo section */}
          {showPhotoPanel && (
            <div style={{ borderTop: "1px solid #eee", paddingTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Photo (Optional)</h3>

              <div style={{ display: "flex", gap: 18, marginBottom: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={photoConsentPdf}
                    onChange={(e) => setPhotoConsentPdf(e.target.checked)}
                  />
                  Consent: include photo in PDF
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={photoConsentPublish}
                    onChange={(e) => setPhotoConsentPublish(e.target.checked)}
                  />
                  Consent: include photo for publishing
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <button
                  onClick={getPhotoUploadUrl}
                  disabled={loading || !sessionId}
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
                >
                  Get Photo Upload URL
                </button>

                <button
                  onClick={skipPhoto}
                  disabled={loading || !sessionId}
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
                >
                  Skip Photo
                </button>
              </div>

              {photoUploadUrl ? (
                <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Upload JPG</div>
                  <input
                    type="file"
                    accept="image/jpeg"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={uploadPhotoAndSubmit}
                      disabled={loading || !photoFile}
                      style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
                    >
                      Upload Photo + Submit
                    </button>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                    Object name: <code>{photoUploadObjectName}</code>
                  </div>
                </div>
              ) : null}

              {photoStatus === "uploaded" && photoObject ? (
                <div style={{ padding: 12, background: "#eef7ee", border: "1px solid #cde9cd", borderRadius: 10 }}>
                  Photo uploaded: <code>{photoObject}</code>
                </div>
              ) : null}

              {photoStatus === "skipped" ? (
                <div style={{ padding: 12, background: "#f5f5f5", border: "1px solid #e5e5e5", borderRadius: 10 }}>
                  Photo skipped.
                </div>
              ) : null}
            </div>
          )}

          {/* DEBUG: preview gating */}
          <div style={{ fontSize: 12, color: "#999", marginTop: 8 }}>
            DEBUG: loaded={String(publishPreviewLoaded)} | approval={String(approvalStatus)} |
            approvedTextLen={String((approvedText || "").length)} | finalLen={String((finalStoryText || "").length)} |
            photoStatus={String(photoStatus)} | photoUrlLen={String((photoPreviewUrl || "").length)}
          </div>


          {/* Publish preview section */}
          {shouldShowPublishPreview && (
            <div style={{ borderTop: "1px solid #eee", paddingTop: 14, marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Publish Preview (Student can review)</h3>

              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 240, maxWidth: 320 }}>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Photo preview</div>
                  {(photoStatus || "").toLowerCase() === "uploaded" ? (
                    photoPreviewUrl ? (
                      <img
                        src={photoPreviewUrl}
                        alt="Student photo preview"
                        style={{ width: "100%", borderRadius: 12, border: "1px solid #ddd" }}
                      />
                    ) : (
                      <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                        No preview URL yet. Click “Load Publish Preview”.
                      </div>
                    )
                  ) : (
                    <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                      Photo skipped.
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 320 }}>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Final story text (what will be published)</div>
                  <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, background: "#fff" }}>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                      {finalStoryText || "(No story text loaded yet. Click “Load Publish Preview”.)"}
                    </pre>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                Tip: Publish preview uses Approved text first, then Edited text, then Draft.
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 22, fontSize: 13, color: "#666" }}>
        <div><strong>Backend:</strong> {API_BASE || "(missing NEXT_PUBLIC_API_BASE)"}</div>
      </div>
    </div>
  );
}
