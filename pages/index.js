/**
 * index_improved.js — CPL Story Interview (Voice + Typed)
 *
 * Fixes applied vs original index.txt / index_ready_no_voice.js:
 *   FIX-01  /submit-final endpoint + "Submit My Story to MAP" button
 *   FIX-02  isUploading state separates voice upload from page loading
 *   FIX-03  apiFetch helper — unified timeout + consistent JSON error handling
 *   FIX-04  MediaRecorder memory leak — mic tracks released on unmount
 *   FIX-05  API_BASE trailing-slash normalisation (carried from index.txt)
 *   FIX-06  Answer + story length validation with live char counters
 *   FIX-07  photoConsentPdf defaults to false (opt-in, FERPA-safe)
 *   FIX-08  Photo file-type + size validation (JPEG only, ≤ MAX_PHOTO_MB)
 *   FIX-09  Request timeouts via AbortController (REQUEST_TIMEOUT_MS)
 *   FIX-10  window.confirm before Approve & Lock
 *   FIX-11  Debug panel removed from production build
 *   FIX-12  Duplicate "Publish preview" comment headers removed
 *   FIX-13  console.log wrapped in devLog (dev-only)
 *   FIX-14  ARIA labels + htmlFor on all interactive controls
 *   FIX-15  Session ID auto-prefix changed to CPL_ (was UI_TEST_)
 *   FIX-16  mountedRef — prevents setState after unmount
 *   FIX-17  Story editor set to readOnly after story is approved
 *   FIX-18  publishStatus state tracks final /submit-final call
 *   FIX-19  Session token read from URL (?session=&token=) and sent as
 *           X-Session-Token header — required when REQUIRE_SESSION_TOKEN=true
 */

import { useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_ANSWER_LEN     = 5_000;   // max chars for a single interview answer
const MAX_STORY_LEN      = 20_000;  // max chars for the story editor
const MAX_PHOTO_MB       = 5;       // max photo upload size in megabytes
const REQUEST_TIMEOUT_MS = 20_000;  // 20 s timeout for all API calls

// FIX-13: dev-only logging — no console.log leaking into production
const isDev = process.env.NODE_ENV === "development";
function devLog(...args) {
  if (isDev) console.log(...args); // eslint-disable-line no-console
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Home() {
  // FIX-05: strip trailing slash so ${API_BASE}/path always works
  const API_BASE = useMemo(
    () => (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, ""),
    []
  );

  // ---- Interview state ----
  const [sessionId,     setSessionId]     = useState("");
  const [prevSessionId, setPrevSessionId] = useState("");
  const [question,      setQuestion]      = useState("");
  const [answer,        setAnswer]        = useState("");
  const [status,        setStatus]        = useState("");
  const [decision,      setDecision]      = useState("");
  const [section,       setSection]       = useState("");
  const [turn,          setTurn]          = useState(null);
  const [reflection,    setReflection]    = useState("");

  // ---- Voice interview state ----
  const [isRecording,  setIsRecording]  = useState(false);
  const [isUploading,  setIsUploading]  = useState(false); // FIX-02
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [transcript,   setTranscript]   = useState("");
  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const activeStreamRef  = useRef(null); // FIX-04: track mic stream for cleanup

  // ---- Story / approval / photo state ----
  const [storyDraft,        setStoryDraft]        = useState("");
  const [storyDraftVersion, setStoryDraftVersion] = useState(null);
  const [approvalStatus,    setApprovalStatus]    = useState("");
  const [editedText,        setEditedText]        = useState("");
  const [approvedText,      setApprovedText]      = useState("");
  const [photoStatus,       setPhotoStatus]       = useState("");
  const [photoObject,       setPhotoObject]       = useState("");
  // FIX-07: both consent flags opt-in (false by default)
  const [photoConsentPdf,     setPhotoConsentPdf]     = useState(false);
  const [photoConsentPublish, setPhotoConsentPublish] = useState(false);

  // Signed upload (photo)
  const [photoUploadUrl,        setPhotoUploadUrl]        = useState("");
  const [photoUploadObjectName, setPhotoUploadObjectName] = useState("");
  const [photoFile,             setPhotoFile]             = useState(null);

  // Publish preview + final submission state
  const [photoPreviewUrl,      setPhotoPreviewUrl]      = useState("");
  const [finalStoryText,       setFinalStoryText]       = useState("");
  const [publishPreviewLoaded, setPublishPreviewLoaded] = useState(false);
  const [publishStatus,        setPublishStatus]        = useState(""); // FIX-01 / FIX-18

  // FIX-19: session token from invite URL (?session=...&token=...)
  // Sent as X-Session-Token header when REQUIRE_SESSION_TOKEN=true on backend
  const [sessionToken, setSessionToken] = useState("");

  // ---- UX ----
  const [error,   setError]   = useState("");
  const [msg,     setMsg]     = useState("");
  const [loading, setLoading] = useState(false);

  // FIX-16: prevent setState after unmount
  const mountedRef = useRef(true);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  // FIX-15 + FIX-19 combined: read invite URL params on mount, then decide
  // whether to use them or auto-generate a session ID.
  //
  // WHY combined: React 18 batches state updates from multiple effects that
  // run on the same render. If FIX-19 and FIX-15 were separate effects, both
  // ran in the same cycle and the last one (FIX-15's CPL_ auto-id) always
  // overwrote the URL session — losing the invite token. One effect, one winner.
  //
  // Flow:
  //   Invite link  → ?session=<id>&token=<tok> → use both, skip auto-generate
  //   Direct access → no URL params            → auto-generate CPL_<timestamp>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params     = new URLSearchParams(window.location.search);
    const urlSession = params.get("session");
    const urlToken   = params.get("token");

    if (urlSession) {
      // Student arrived via invite email link — use the pre-created session + token
      setSessionId(urlSession);
      setSessionToken(urlToken || "");
    } else {
      // Direct / staff-testing access — auto-generate a throwaway session ID
      setSessionId(`CPL_${Date.now()}`);
    }
  }, []); // run exactly once on mount

  // Clear stale preview when session ID changes
  useEffect(() => {
    if (!sessionId) return;
    if (prevSessionId && prevSessionId !== sessionId) {
      setPublishPreviewLoaded(false);
      setPhotoPreviewUrl("");
      setFinalStoryText("");
      setPublishStatus("");
    }
    setPrevSessionId(sessionId);
  }, [sessionId, prevSessionId]);

  // FIX-04 + FIX-16: release mic stream and mark component unmounted
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Stop any live microphone track
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = null;
      }
      // Stop recorder if still running
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") {
        try { mr.stop(); } catch (_) {}
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function resetMessages() {
    setError("");
    setMsg("");
  }

  function requireBaseAndSession() {
    if (!API_BASE)   throw new Error("Missing NEXT_PUBLIC_API_BASE in .env.local");
    if (!sessionId)  throw new Error("Missing sessionId");
  }

  /**
   * FIX-03 + FIX-09: Unified fetch wrapper for all calls to our own API.
   * - Adds AbortController timeout (default REQUEST_TIMEOUT_MS).
   * - Consistently parses JSON and throws a human-readable error on failure.
   * NOTE: Not used for GCS signed-URL PUT calls (those go to external URLs).
   */
  async function apiFetch(
    path,
    body = null,
    { method = "POST", timeoutMs = REQUEST_TIMEOUT_MS } = {}
  ) {
    requireBaseAndSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // FIX-19: include session token when present (backend validates it)
      const headers = { "Content-Type": "application/json" };
      if (sessionToken) headers["X-Session-Token"] = sessionToken;
      const opts = {
        method,
        signal: controller.signal,
        headers,
      };
      if (body !== null) opts.body = JSON.stringify(body);
      const res  = await fetch(`${API_BASE}${path}`, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `${path} failed (${res.status})`);
      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        throw new Error(`Request timed out (${path}). Please try again.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * FIX-09: GET wrapper with timeout (apiFetch handles POST; this handles GET).
   */
  async function apiGet(path, timeoutMs = REQUEST_TIMEOUT_MS) {
    requireBaseAndSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // FIX-19: include session token header on GET requests too
      const headers = {};
      if (sessionToken) headers["X-Session-Token"] = sessionToken;
      const res  = await fetch(`${API_BASE}${path}`, {
        signal: controller.signal,
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `${path} failed (${res.status})`);
      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        throw new Error(`Request timed out (${path}). Please try again.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------
  // Interview endpoints
  // ---------------------------------------------------------------------------

  async function startInterview() {
    resetMessages();
    setLoading(true);
    try {
      const data = await apiFetch("/start-session", { session_id: sessionId });
      if (!mountedRef.current) return;
      setStatus(data.status || "in_progress");
      setSection(data.current_section || "Background");
      setTurn(data.turn ?? 1);
      setQuestion(data.question_text || "");
      setDecision("");
      setReflection("");
      setAnswer("");
      setMsg("Interview started. Answer the question below.");
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function submitAnswer() {
    resetMessages();
    // FIX-06: enforce length limit before hitting the network
    if (answer.length > MAX_ANSWER_LEN) {
      setError(
        `Answer is too long (${answer.length.toLocaleString()} / ${MAX_ANSWER_LEN.toLocaleString()} chars). Please shorten it.`
      );
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch("/answer", {
        session_id: sessionId,
        answer_text: answer,
      });
      if (!mountedRef.current) return;
      setStatus(data.status || "in_progress");
      setDecision(data.decision || "");
      setSection(data.current_section || section);
      setTurn(data.turn ?? turn);
      setReflection(data.agent_reflection || "");
      setQuestion(data.next_question || "");
      setAnswer("");
      setMsg("Answer saved.");
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Voice recording
  // ---------------------------------------------------------------------------

  async function startRecording() {
    resetMessages();
    setTranscript("");
    setRecordedBlob(null);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError("Microphone access denied. Please allow microphone access and try again.");
      return;
    }

    // FIX-04: store ref so cleanup can stop the stream on unmount
    activeStreamRef.current = stream;

    const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    mediaRecorderRef.current = mr;
    chunksRef.current = [];

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      if (mountedRef.current) setRecordedBlob(blob);
      // Release mic tracks as soon as recording stops
      stream.getTracks().forEach((t) => t.stop());
      activeStreamRef.current = null;
    };

    mr.start();
    setIsRecording(true);
    setMsg('Recording… click "Stop" when done.');
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.stop();
    setIsRecording(false);
    setMsg('Recording stopped. Click "Upload + Transcribe + Submit".');
  }

  async function uploadTranscribeAndSubmitVoice() {
    resetMessages();
    // FIX-02: dedicated isUploading flag so the rest of the page stays usable
    setIsUploading(true);
    try {
      requireBaseAndSession();
      if (!recordedBlob) throw new Error("No recording yet. Record audio first.");
      if (turn == null)  throw new Error("Turn is not set yet. Start Interview first.");

      devLog("VOICE flow", { sessionId, turn, blobSize: recordedBlob.size }); // FIX-13

      // 1) Get signed PUT URL for audio
      const upData = await apiFetch("/upload-url", { session_id: sessionId, turn });
      if (!upData.upload_url) throw new Error("upload-url did not return upload_url");

      // 2) PUT audio bytes directly to GCS (external URL — bypass apiFetch)
      const contentType = recordedBlob.type || "audio/webm";
      const putRes = await fetch(upData.upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: recordedBlob,
      });
      if (!putRes.ok) {
        const t = await putRes.text().catch(() => "");
        throw new Error(`Audio PUT failed (${putRes.status}): ${t}`);
      }

      // 3) Tell backend to transcribe + score
      const data = await apiFetch("/submit-turn", { session_id: sessionId, turn });
      if (!mountedRef.current) return;

      setStatus(data.status || "in_progress");
      setDecision(data.decision || "");
      setSection(data.current_section || section);
      setTurn(data.turn ?? turn);
      setReflection(data.agent_reflection || "");
      setQuestion(data.next_question || "");
      setRecordedBlob(null);
      setAnswer("");
      setMsg("Voice answer submitted.");
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setIsUploading(false);
    }
  }

  async function finishInterview() {
    resetMessages();
    setLoading(true);
    try {
      const data = await apiFetch("/finish", { session_id: sessionId });
      if (!mountedRef.current) return;
      setStatus(data.status || "complete");
      setDecision("finished");
      setMsg("Interview finished. Next: Generate Draft.");
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Session refresh (/story)
  // ---------------------------------------------------------------------------

  async function refreshSession(opts = { quiet: false }) {
    if (!opts?.quiet) resetMessages();
    setLoading(true);
    try {
      const data = await apiGet(
        `/story?session_id=${encodeURIComponent(sessionId)}`
      );
      if (!mountedRef.current) return;
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
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Draft → Edit → Approve flow
  // ---------------------------------------------------------------------------

  async function generateDraft() {
    resetMessages();
    setLoading(true);
    try {
      const data = await apiFetch("/compile-story", { session_id: sessionId });
      if (!mountedRef.current) return;
      const draft = data.story_draft || "";
      setStoryDraft(draft);
      setApprovalStatus(data.approval_status || "needs_review");
      if (data.story_draft_version !== undefined && data.story_draft_version !== null) {
        setStoryDraftVersion(data.story_draft_version);
      }
      setEditedText(draft);
      setPublishPreviewLoaded(false);
      setPhotoPreviewUrl("");
      setFinalStoryText("");
      setMsg(
        "Draft generated and loaded into the editor. Edit it, then Save Edits (optional), then Approve & Lock."
      );
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function saveEdits() {
    resetMessages();
    if (!editedText.trim()) {
      setError("Editor is empty. Generate draft first (or paste text).");
      return;
    }
    // FIX-06: enforce story length limit
    if (editedText.length > MAX_STORY_LEN) {
      setError(
        `Story is too long (${editedText.length.toLocaleString()} / ${MAX_STORY_LEN.toLocaleString()} chars). Please shorten it.`
      );
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch("/edit-story", {
        session_id: sessionId,
        edited_story_text: editedText,
      });
      if (!mountedRef.current) return;
      setApprovalStatus(data.approval_status || "needs_review");
      setPublishPreviewLoaded(false);
      setMsg("Edits saved. Now click Approve & Lock.");
      await refreshSession({ quiet: true });
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function approveStory(wantPhoto) {
    // FIX-10: require explicit confirmation — this action is irreversible
    if (
      !window.confirm(
        "Are you sure? This will lock your story — it cannot be edited further."
      )
    )
      return;

    resetMessages();
    setLoading(true);
    try {
      const data = await apiFetch("/approve-story", {
        session_id: sessionId,
        want_photo: wantPhoto,
        photo_consent_pdf: photoConsentPdf,
        photo_consent_publish: photoConsentPublish,
      });
      if (!mountedRef.current) return;
      setApprovalStatus(data.approval_status || "approved");
      setPhotoStatus(data.photo_status || (wantPhoto ? "requested" : "skipped"));
      setPublishPreviewLoaded(false);
      setPhotoPreviewUrl("");
      setFinalStoryText("");
      setMsg(
        wantPhoto
          ? "Approved and locked. Next: upload photo (optional)."
          : "Approved and locked. Photo skipped."
      );
      await refreshSession({ quiet: true });
      if (!wantPhoto) await loadPublishPreview();
      if ((data.photo_status || "").toLowerCase() === "uploaded") await loadPublishPreview();
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Photo flow
  // ---------------------------------------------------------------------------

  async function getPhotoUploadUrl() {
    resetMessages();
    setLoading(true);
    try {
      const data = await apiFetch("/photo-upload-url", { session_id: sessionId });
      if (!mountedRef.current) return;
      setPhotoUploadUrl(data.upload_url || "");
      setPhotoUploadObjectName(data.object_name || "");
      setMsg("Photo upload URL created. Choose a JPG and upload.");
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function uploadPhotoAndSubmit() {
    resetMessages();
    setLoading(true);
    try {
      if (!photoFile)      throw new Error("Please choose a JPG file first.");
      if (!photoUploadUrl) throw new Error('Missing upload URL. Click "Get Photo Upload URL" first.');

      // FIX-08: validate file type and size before touching the network
      if (!photoFile.type.startsWith("image/jpeg")) {
        throw new Error("Please upload a JPEG image (.jpg). Other formats are not accepted.");
      }
      if (photoFile.size > MAX_PHOTO_MB * 1024 * 1024) {
        throw new Error(
          `Photo must be under ${MAX_PHOTO_MB} MB (file is ${(photoFile.size / 1024 / 1024).toFixed(1)} MB).`
        );
      }

      // 1) PUT bytes to signed URL (external — bypass apiFetch)
      const putRes = await fetch(photoUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: photoFile,
      });
      if (!putRes.ok) {
        const t = await putRes.text().catch(() => "");
        throw new Error(`Photo PUT failed (${putRes.status}): ${t}`);
      }

      // 2) Confirm with backend
      const data = await apiFetch("/submit-photo", {
        session_id: sessionId,
        photo_object: photoUploadObjectName || `photos/${sessionId}/profile.jpg`,
        photo_consent_pdf: photoConsentPdf,
        photo_consent_publish: photoConsentPublish,
      });
      if (!mountedRef.current) return;
      setPhotoStatus(data.photo_status || "uploaded");
      setPhotoObject(data.photo_object || "");
      setMsg("Photo uploaded and saved. Loading publish preview…");
      await loadPublishPreview();
      await refreshSession({ quiet: true });
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function skipPhoto() {
    resetMessages();
    setLoading(true);
    try {
      const data = await apiFetch("/skip-photo", { session_id: sessionId });
      if (!mountedRef.current) return;
      setPhotoStatus(data.photo_status || "skipped");
      setMsg("Photo skipped.");
      setPhotoPreviewUrl("");
      await refreshSession({ quiet: true });
      await loadPublishPreview();
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Publish preview
  // ---------------------------------------------------------------------------

  async function loadPublishPreview() {
    const sid  = sessionId;
    const base = API_BASE;
    devLog("loadPublishPreview called", { sid, base }); // FIX-13

    setLoading(true);
    setError("");
    setMsg("Loading publish preview…");
    setPublishPreviewLoaded(false);

    try {
      requireBaseAndSession();

      // 1) Fetch session story (GET)
      const storyData = await apiGet(
        `/story?session_id=${encodeURIComponent(sid)}`
      );
      if (!mountedRef.current) return;

      const nextApprovalStatus = storyData.approval_status    ?? approvalStatus;
      const nextPhotoStatus    = storyData.photo_status        ?? photoStatus;
      const nextApprovedText   = storyData.approved_story_text ?? approvedText;

      setApprovalStatus(nextApprovalStatus);
      setPhotoStatus(nextPhotoStatus);
      setApprovedText(nextApprovedText);

      const best =
        String(storyData.approved_story_text || "").trim() ||
        String(storyData.edited_story_text   || "").trim() ||
        String(storyData.story_draft         || "").trim();
      setFinalStoryText(best);

      // 2) Photo preview URL — only if a photo was uploaded
      const ps = String(nextPhotoStatus || "").trim().toLowerCase();
      devLog("photo_status in loadPublishPreview", ps); // FIX-13
      if (ps === "uploaded") {
        const previewData = await apiFetch("/photo-preview-url", { session_id: sid });
        if (!mountedRef.current) return;
        const url = previewData.preview_url || previewData.view_url || "";
        setPhotoPreviewUrl(url);
      } else {
        setPhotoPreviewUrl("");
      }

      setMsg("Publish preview loaded.");
      setPublishPreviewLoaded(true);
    } catch (e) {
      devLog("ERR: loadPublishPreview", e); // FIX-13
      if (mountedRef.current) {
        setError(String(e?.message || e));
        setPublishPreviewLoaded(false);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // FIX-01: Submit final story to MAP
  // ---------------------------------------------------------------------------

  async function submitFinal() {
    resetMessages();
    setLoading(true);
    try {
      const data = await apiFetch("/submit-final", { session_id: sessionId });
      if (!mountedRef.current) return;
      setPublishStatus(data.publish_status || "publish_ready"); // FIX-18
      setMsg(data.message || "Your story has been submitted to MAP. Thank you!");
    } catch (e) {
      if (mountedRef.current) setError(String(e.message || e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Quick demo content for testing
  // ---------------------------------------------------------------------------

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
      "I'm working toward a certificate, and CPL helped me finish sooner and qualify to apply for a higher-paying role in healthcare.",
      "",
      "Impact: CPL saved me time and money and made me feel valued for my experience.",
    ].join("\n");
    setEditedText(demo);
    setMsg("Demo draft inserted into editor. Click Save Edits (optional) → Approve & Lock.");
  }

  // ---------------------------------------------------------------------------
  // Derived UI flags
  // ---------------------------------------------------------------------------

  // FIX-17: detect locked state to make editor read-only
  const isLocked = (approvalStatus || "").toLowerCase() === "approved";

  const canSubmitAnswer = !!sessionId && !!question && !!answer.trim() && !loading;

  const showStoryPanel =
    status === "complete"  ||
    status === "needs_review" ||
    !!storyDraft ||
    !!editedText ||
    !!approvedText ||
    !!approvalStatus;

  const showPhotoPanel =
    approvalStatus === "approved" ||
    !!approvedText ||
    ["requested", "uploaded", "skipped"].includes((photoStatus || "").toLowerCase());

  const shouldShowPublishPreview =
    publishPreviewLoaded &&
    (
      String(approvalStatus || "").trim().toLowerCase() === "approved" ||
      String(approvedText   || "").trim().length > 0 ||
      String(finalStoryText || "").trim().length > 0
    );

  const alreadySubmitted = !!publishStatus; // FIX-18

  const canGenerateDraft = !!sessionId && !loading;
  const canSaveEdits     = !!sessionId && !!editedText.trim() && !loading && !isLocked;
  const canApprove       =
    !!sessionId &&
    !loading &&
    !isLocked &&
    (!!editedText.trim() || !!storyDraft.trim());

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 980, margin: "30px auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>CPL Story Interview</h1>

      {/* ---- Session ID row ---- */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        {/* FIX-14: htmlFor + aria-label */}
        <label htmlFor="session-id-input" style={{ minWidth: 90 }}>Session ID</label>
        <input
          id="session-id-input"
          aria-label="Session ID"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          style={{ flex: 1, minWidth: 280, padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
        <button
          onClick={startInterview}
          disabled={loading || !sessionId}
          aria-label="Start interview session"
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
        >
          Start Interview
        </button>
        <button
          onClick={() => refreshSession()}
          disabled={loading || !sessionId}
          aria-label="Refresh session from backend"
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
        >
          Refresh Session
        </button>
      </div>

      {/* ---- Status bar ---- */}
      <div style={{ marginBottom: 12, color: "#444" }}>
        <strong>Status:</strong> {status || "-"}{" "}
        <span style={{ marginLeft: 12 }}><strong>Section:</strong> {section || "-"}</span>{" "}
        <span style={{ marginLeft: 12 }}><strong>Turn:</strong> {turn ?? "-"}</span>{" "}
        <span style={{ marginLeft: 12 }}><strong>Decision:</strong> {decision || "-"}</span>
      </div>

      {/* ---- Error / Message banners ---- */}
      {error ? (
        <div
          role="alert"
          style={{ padding: 12, background: "#ffe8e8", border: "1px solid #ffb3b3", borderRadius: 8, marginBottom: 16 }}
        >
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      {msg ? (
        <div
          role="status"
          style={{ padding: 12, background: "#eef7ee", border: "1px solid #cde9cd", borderRadius: 8, marginBottom: 16 }}
        >
          {msg}
        </div>
      ) : null}

      {/* ==================================================================== */}
      {/* Interview panel                                                       */}
      {/* ==================================================================== */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Interview</h2>

        {/* Current question */}
        <div style={{ padding: 14, border: "1px solid #eee", borderRadius: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Question</div>
          <div style={{ fontSize: 18, lineHeight: 1.4 }}>
            {question || 'Click "Start Interview" to fetch the first question.'}
          </div>
        </div>

        {/* Agent reflection */}
        {reflection ? (
          <div style={{ padding: 12, background: "#f5f5f5", border: "1px solid #e5e5e5", borderRadius: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Agent reflection</div>
            <div>{reflection}</div>
          </div>
        ) : null}

        {/* Answer textarea + char counter (FIX-06 + FIX-14) */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <label htmlFor="answer-textarea" style={{ fontSize: 13, color: "#666" }}>
              Student Answer
            </label>
            <span style={{ fontSize: 12, color: answer.length > MAX_ANSWER_LEN ? "#c00" : "#999" }}>
              {answer.length.toLocaleString()} / {MAX_ANSWER_LEN.toLocaleString()}
            </span>
          </div>
          <textarea
            id="answer-textarea"
            aria-label="Student answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            maxLength={MAX_ANSWER_LEN}
            style={{ width: "100%", padding: 12, border: "1px solid #ccc", borderRadius: 10, boxSizing: "border-box" }}
            placeholder="Type the student's answer here…"
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={submitAnswer}
            disabled={!canSubmitAnswer}
            aria-label="Submit typed answer"
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
          >
            Submit Answer (Typed)
          </button>

          <button
            onClick={startRecording}
            disabled={loading || isUploading || !sessionId || !question || isRecording}
            aria-label="Start voice recording"
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
          >
            🎙 Start Recording
          </button>

          <button
            onClick={stopRecording}
            disabled={!isRecording}
            aria-label="Stop voice recording"
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
          >
            ⏹ Stop
          </button>

          {/* FIX-02: disabled on isUploading, not on loading */}
          <button
            onClick={uploadTranscribeAndSubmitVoice}
            disabled={isUploading || !recordedBlob || turn == null}
            aria-label="Upload, transcribe, and submit voice answer"
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
          >
            {isUploading ? "Uploading…" : "⬆️ Upload + Transcribe + Submit (Voice)"}
          </button>

          <button
            onClick={finishInterview}
            disabled={loading}
            aria-label="Finish interview"
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333" }}
          >
            Finish Interview
          </button>
        </div>

        {/* Recording indicator */}
        {isRecording && (
          <div role="status" style={{ marginTop: 8, color: "#c00", fontWeight: "bold" }}>
            ● Recording…
          </div>
        )}

        {/* Upload indicator (FIX-02) */}
        {isUploading && (
          <div role="status" style={{ marginTop: 8, color: "#555" }}>
            ⏳ Uploading and transcribing voice answer…
          </div>
        )}

        {/* Transcript display */}
        {transcript ? (
          <div style={{ marginTop: 10, padding: 10, border: "1px solid #ddd", borderRadius: 8, background: "#fafafa" }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Transcript (from voice)</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{transcript}</div>
          </div>
        ) : null}
      </div>

      {/* ==================================================================== */}
      {/* Story panel                                                           */}
      {/* ==================================================================== */}
      {showStoryPanel && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>
            Draft → Student Edit → Approve &amp; Lock → Photo (Optional)
          </h2>

          {/* Story action buttons */}
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={generateDraft}
              disabled={!canGenerateDraft}
              aria-label="Generate AI story draft"
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Generate Draft
            </button>

            <button
              onClick={quickFillDemoDraft}
              disabled={loading || isLocked}
              aria-label="Insert demo draft"
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Quick Fill Demo Draft
            </button>

            <button
              onClick={saveEdits}
              disabled={!canSaveEdits}
              aria-label="Save story edits"
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Save Edits
            </button>

            {/* FIX-10: confirmation happens inside approveStory */}
            <button
              onClick={() => approveStory(true)}
              disabled={!canApprove}
              aria-label="Approve and lock story, then add photo"
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Approve &amp; Lock (then photo)
            </button>

            <button
              onClick={() => approveStory(false)}
              disabled={!canApprove}
              aria-label="Approve and lock story, skip photo"
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Approve &amp; Lock (skip photo)
            </button>

            <button
              onClick={() => loadPublishPreview()}
              disabled={loading || !sessionId}
              aria-label="Load publish preview"
              style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
            >
              Load Publish Preview
            </button>
          </div>

          {/* Status row */}
          <div style={{ marginBottom: 10, color: "#444" }}>
            <strong>Approval:</strong> {approvalStatus || "-"}{" "}
            <span style={{ marginLeft: 12 }}><strong>Photo status:</strong> {photoStatus || "-"}</span>{" "}
            <span style={{ marginLeft: 12 }}><strong>Draft version:</strong> {storyDraftVersion ?? "-"}</span>
          </div>

          {/* FIX-17: locked notice */}
          {isLocked && (
            <div style={{ padding: 10, background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 8, marginBottom: 12 }}>
              🔒 Story is approved and locked. The editor below is read-only.
            </div>
          )}

          {/* Story editor + char counter (FIX-06 + FIX-14 + FIX-17) */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <label htmlFor="story-editor" style={{ fontSize: 13, color: "#666" }}>
                {isLocked
                  ? "Student Editor (read-only — story locked)"
                  : 'Student Editor (AI draft loads here after "Generate Draft")'}
              </label>
              <span style={{ fontSize: 12, color: editedText.length > MAX_STORY_LEN ? "#c00" : "#999" }}>
                {editedText.length.toLocaleString()} / {MAX_STORY_LEN.toLocaleString()}
              </span>
            </div>
            <textarea
              id="story-editor"
              aria-label="Story editor"
              aria-readonly={isLocked}
              value={editedText}
              onChange={(e) => { if (!isLocked) setEditedText(e.target.value); }}
              readOnly={isLocked}
              rows={12}
              style={{
                width: "100%",
                padding: 12,
                border: "1px solid #ccc",
                borderRadius: 10,
                boxSizing: "border-box",
                background: isLocked ? "#f9f9f9" : "#fff",
                cursor: isLocked ? "not-allowed" : "text",
              }}
              placeholder='Click "Generate Draft", or use "Quick Fill Demo Draft"…'
            />
          </div>

          {/* Approved / locked story preview */}
          {approvedText ? (
            <div style={{ padding: 12, background: "#f5fbff", border: "1px solid #d8efff", borderRadius: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Approved Story (locked)</div>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{approvedText}</pre>
            </div>
          ) : null}

          {/* ---------------------------------------------------------------- */}
          {/* Photo section                                                     */}
          {/* ---------------------------------------------------------------- */}
          {showPhotoPanel && (
            <div style={{ borderTop: "1px solid #eee", paddingTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Photo (Optional)</h3>

              {/* FIX-07: both checkboxes default false; user must opt in */}
              <div style={{ display: "flex", gap: 18, marginBottom: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    aria-label="Consent to include photo in PDF"
                    checked={photoConsentPdf}
                    onChange={(e) => setPhotoConsentPdf(e.target.checked)}
                  />
                  Consent: include photo in PDF
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    aria-label="Consent to publish photo online"
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
                  aria-label="Get photo upload URL"
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
                >
                  Get Photo Upload URL
                </button>

                <button
                  onClick={skipPhoto}
                  disabled={loading || !sessionId}
                  aria-label="Skip photo upload"
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #333", cursor: "pointer" }}
                >
                  Skip Photo
                </button>
              </div>

              {photoUploadUrl ? (
                <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
                    Upload JPG (max {MAX_PHOTO_MB} MB)
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg"
                    aria-label="Choose JPEG photo file"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  />
                  {/* FIX-08: live file validation feedback */}
                  {photoFile && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                      Selected: {photoFile.name}{" "}
                      ({(photoFile.size / 1024 / 1024).toFixed(2)} MB)
                      {!photoFile.type.startsWith("image/jpeg") && (
                        <span style={{ color: "#c00", marginLeft: 8 }}>⚠ Must be a JPEG file</span>
                      )}
                      {photoFile.size > MAX_PHOTO_MB * 1024 * 1024 && (
                        <span style={{ color: "#c00", marginLeft: 8 }}>
                          ⚠ File too large (max {MAX_PHOTO_MB} MB)
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={uploadPhotoAndSubmit}
                      disabled={loading || !photoFile}
                      aria-label="Upload photo and confirm with backend"
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

          {/* FIX-11: DEBUG panel removed — was visible in production build */}

          {/* ---------------------------------------------------------------- */}
          {/* Publish preview                                                   */}
          {/* ---------------------------------------------------------------- */}
          {shouldShowPublishPreview && (
            <div style={{ borderTop: "1px solid #eee", paddingTop: 14, marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Publish Preview (Student can review)</h3>

              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                {/* Photo column */}
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
                        No preview URL yet. Click "Load Publish Preview".
                      </div>
                    )
                  ) : (
                    <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                      Photo skipped.
                    </div>
                  )}
                </div>

                {/* Story text column */}
                <div style={{ flex: 1, minWidth: 320 }}>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
                    Final story text (what will be published)
                  </div>
                  <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12, background: "#fff" }}>
                    <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                      {finalStoryText || '(No story text loaded yet. Click "Load Publish Preview".)'}
                    </pre>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                Tip: Publish preview uses Approved text first, then Edited text, then Draft.
              </div>

              {/* FIX-01: Submit to MAP button / confirmation message */}
              <div style={{ marginTop: 16 }}>
                {alreadySubmitted ? (
                  <div
                    style={{
                      padding: 14,
                      background: "#eef7ee",
                      border: "1px solid #cde9cd",
                      borderRadius: 10,
                      fontWeight: "bold",
                    }}
                  >
                    ✅ Story submitted to MAP! Staff will review before publishing.
                  </div>
                ) : (
                  <button
                    onClick={submitFinal}
                    disabled={loading}
                    aria-label="Submit story to MAP for review"
                    style={{
                      padding: "12px 20px",
                      borderRadius: 10,
                      border: "none",
                      background: "#1a7f3c",
                      color: "#fff",
                      fontWeight: "bold",
                      fontSize: 15,
                      cursor: loading ? "not-allowed" : "pointer",
                      opacity: loading ? 0.7 : 1,
                    }}
                  >
                    ✅ Submit My Story to MAP
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 22, fontSize: 13, color: "#666" }}>
        <div><strong>Backend:</strong> {API_BASE || "(missing NEXT_PUBLIC_API_BASE)"}</div>
      </div>
    </div>
  );
}
