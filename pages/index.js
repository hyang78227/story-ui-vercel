/**
 * index.js — CPL Story Interview (Voice + Typed) — MAP Initiative branded UI
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
 *   UI-01   MAP Initiative branding (navy/red/gold palette, logo, progress bar)
 */

import { useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_ANSWER_LEN     = 5_000;   // max chars for a single interview answer
const MAX_STORY_LEN      = 20_000;  // max chars for the story editor
const MAX_PHOTO_MB       = 5;       // max photo upload size in megabytes
const REQUEST_TIMEOUT_MS = 20_000;  // 20 s timeout for all API calls

// MAP Initiative brand palette
const C = {
  navy:        "#1B3A6B",
  navyDark:    "#142d54",
  navyLight:   "#2a4f8f",
  red:         "#B22234",
  gold:        "#E8A020",
  goldLight:   "#f5c842",
  white:       "#ffffff",
  offWhite:    "#f5f7fa",
  border:      "#d8e2f0",
  textDark:    "#1a1a2e",
  textMid:     "#4a5568",
  textLight:   "#718096",
  green:       "#1a7f3c",
  greenLight:  "#eef7ee",
  greenBorder: "#cde9cd",
  errorBg:     "#fff0f0",
  errorBorder: "#ffb3b3",
  warnBg:      "#fffbe6",
  warnBorder:  "#ffe58f",
};

// Interview sections in order
const SECTIONS = ["Background", "Barrier", "CPL Moment", "Impact", "Outcome", "Reflection"];

// Section-specific guidance shown below the question
const SECTION_GUIDANCE = {
  "Background":  "Tell us a little about yourself — your work experience, military service, or training before college.",
  "Barrier":     "Share a challenge or obstacle you faced when trying to access higher education.",
  "CPL Moment":  "Describe how your prior learning, work, or military experience was recognized for college credit.",
  "Impact":      "How did earning Credit for Prior Learning change your college journey or save you time and money?",
  "Outcome":     "What are you working toward now? How has CPL helped you move closer to your goals?",
  "Reflection":  "Looking back, what would you tell another working adult or veteran about CPL?",
};

// FIX-13: dev-only logging — no console.log leaking into production
const isDev = process.env.NODE_ENV === "development";
function devLog(...args) {
  if (isDev) console.log(...args); // eslint-disable-line no-console
}

// ---------------------------------------------------------------------------
// MAP Logo SVG component — matches real California MAP Initiative logo
// ---------------------------------------------------------------------------
function MapLogo({ size = 48 }) {
  // Scale factor: design is based on 120×56 viewBox
  return (
    <svg width={size * 2.14} height={size} viewBox="0 0 120 56" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-label="California MAP Initiative Logo">
      {/* "California" in italic script */}
      <text x="3" y="14" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic"
            fontSize="12" fontWeight="600" fill={C.navy} letterSpacing="0.2">California</text>

      {/* Large "M" */}
      <text x="2" y="44" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="900"
            fill={C.navy} letterSpacing="-1">M</text>

      {/* Large "A" with red triangle arrow inside */}
      <text x="34" y="44" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="900"
            fill={C.navy} letterSpacing="-1">A</text>
      {/* Red upward arrow / triangle inside the A */}
      <polygon points="46,38 50,26 54,38" fill={C.red} />

      {/* Large "P" */}
      <text x="66" y="44" fontFamily="Arial, sans-serif" fontSize="34" fontWeight="900"
            fill={C.navy} letterSpacing="-1">P</text>

      {/* "INITIATIVE" in spaced small caps */}
      <text x="2" y="53" fontFamily="Arial, sans-serif" fontSize="7" fontWeight="700"
            fill={C.navy} letterSpacing="3.2">INITIATIVE</text>

      {/* Tagline */}
      <text x="2" y="60" fontFamily="Arial, sans-serif" fontSize="5" fontWeight="500"
            fill={C.textMid} letterSpacing="0.8">MAPPING ARTICULATED PATHWAYS</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Progress step bar
// ---------------------------------------------------------------------------
function ProgressBar({ currentSection, status }) {
  const activeIdx = SECTIONS.findIndex(
    (s) => s.toLowerCase() === (currentSection || "").toLowerCase()
  );
  const isDone = status === "complete";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24, flexWrap: "wrap" }}>
      {SECTIONS.map((s, i) => {
        const isActive    = i === activeIdx && !isDone;
        const isCompleted = isDone || i < activeIdx;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: "1 1 auto" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 56 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: "bold",
                  background: isCompleted ? C.green : isActive ? C.navy : C.border,
                  color: isCompleted || isActive ? C.white : C.textMid,
                  border: isActive ? `3px solid ${C.gold}` : "none",
                  transition: "all 0.3s",
                  boxShadow: isActive ? `0 0 0 3px ${C.gold}33` : "none",
                }}
              >
                {isCompleted ? "✓" : i + 1}
              </div>
              <div
                style={{
                  fontSize: 9,
                  marginTop: 3,
                  color: isActive ? C.navy : isCompleted ? C.green : C.textLight,
                  fontWeight: isActive ? "bold" : "normal",
                  textAlign: "center",
                  maxWidth: 56,
                  lineHeight: 1.2,
                }}
              >
                {s}
              </div>
            </div>
            {i < SECTIONS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 3,
                  background: i < activeIdx || isDone ? C.green : C.border,
                  margin: "0 2px",
                  marginBottom: 16,
                  borderRadius: 2,
                  transition: "background 0.3s",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable styled card
// ---------------------------------------------------------------------------
function Card({ children, accentColor, style = {} }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderLeft: accentColor ? `4px solid ${accentColor}` : `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
        boxShadow: "0 2px 8px rgba(27,58,107,0.07)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styled button helper
// ---------------------------------------------------------------------------
function Btn({ onClick, disabled, children, variant = "secondary", ariaLabel, style = {} }) {
  const base = {
    padding: "10px 18px",
    borderRadius: 8,
    fontWeight: "600",
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    transition: "all 0.2s",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const variants = {
    primary:   { background: C.navy, color: C.white },
    danger:    { background: C.red, color: C.white },
    success:   { background: C.green, color: C.white },
    gold:      { background: C.gold, color: C.navyDark },
    outline:   { background: "transparent", color: C.navy, border: `2px solid ${C.navy}` },
    ghost:     { background: C.offWhite, color: C.textDark, border: `1px solid ${C.border}` },
    recording: { background: "#c00", color: C.white },
    secondary: { background: C.offWhite, color: C.textDark, border: `1px solid ${C.border}` },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
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
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params     = new URLSearchParams(window.location.search);
    const urlSession = params.get("session");
    const urlToken   = params.get("token");

    if (urlSession) {
      setSessionId(urlSession);
      setSessionToken(urlToken || "");
    } else {
      setSessionId(`CPL_${Date.now()}`);
    }
  }, []);

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
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = null;
      }
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

  async function apiFetch(
    path,
    body = null,
    { method = "POST", timeoutMs = REQUEST_TIMEOUT_MS } = {}
  ) {
    requireBaseAndSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
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

  async function apiGet(path, timeoutMs = REQUEST_TIMEOUT_MS) {
    requireBaseAndSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
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
    setIsUploading(true);
    try {
      requireBaseAndSession();
      if (!recordedBlob) throw new Error("No recording yet. Record audio first.");
      if (turn == null)  throw new Error("Turn is not set yet. Start Interview first.");

      devLog("VOICE flow", { sessionId, turn, blobSize: recordedBlob.size });

      const upData = await apiFetch("/upload-url", { session_id: sessionId, turn });
      if (!upData.upload_url) throw new Error("upload-url did not return upload_url");

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

      if (!photoFile.type.startsWith("image/jpeg")) {
        throw new Error("Please upload a JPEG image (.jpg). Other formats are not accepted.");
      }
      if (photoFile.size > MAX_PHOTO_MB * 1024 * 1024) {
        throw new Error(
          `Photo must be under ${MAX_PHOTO_MB} MB (file is ${(photoFile.size / 1024 / 1024).toFixed(1)} MB).`
        );
      }

      const putRes = await fetch(photoUploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: photoFile,
      });
      if (!putRes.ok) {
        const t = await putRes.text().catch(() => "");
        throw new Error(`Photo PUT failed (${putRes.status}): ${t}`);
      }

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
    devLog("loadPublishPreview called", { sid, base });

    setLoading(true);
    setError("");
    setMsg("Loading publish preview…");
    setPublishPreviewLoaded(false);

    try {
      requireBaseAndSession();

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

      const ps = String(nextPhotoStatus || "").trim().toLowerCase();
      devLog("photo_status in loadPublishPreview", ps);
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
      devLog("ERR: loadPublishPreview", e);
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
      setPublishStatus(data.publish_status || "publish_ready");
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

  const alreadySubmitted = !!publishStatus;

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
    <div style={{ minHeight: "100vh", background: C.offWhite, fontFamily: "'Segoe UI', Arial, sans-serif", color: C.textDark }}>

      {/* ================================================================== */}
      {/* HEADER                                                              */}
      {/* ================================================================== */}
      <header
        style={{
          background: C.navy,
          color: C.white,
          padding: "0 24px",
          boxShadow: "0 3px 12px rgba(0,0,0,0.25)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, height: 70 }}>
          <MapLogo size={44} />
          <div>
            <div style={{ fontWeight: "700", fontSize: 17, letterSpacing: 0.3, lineHeight: 1.1 }}>
              California MAP Initiative
            </div>
            <div style={{ fontSize: 11, color: C.gold, fontWeight: "500", letterSpacing: 0.2, lineHeight: 1.2, maxWidth: 480 }}>
              Mapping Articulated Pathways · Credit for Prior Learning · Working Adults &amp; Veterans
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {/* Link to published stories */}
            <a
              href="https://map.rccd.edu/mycplstory/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: C.gold,
                color: C.navyDark,
                fontWeight: "700",
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 20,
                textDecoration: "none",
                letterSpacing: 0.2,
                whiteSpace: "nowrap",
              }}
            >
              📖 Read CPL Stories
            </a>
            <div style={{ fontSize: 12, color: C.gold, fontWeight: "700", textAlign: "right" }}>CPL Story Interview</div>
            {sessionId && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontFamily: "monospace" }}>
                {sessionId.slice(0, 22)}{sessionId.length > 22 ? "…" : ""}
              </div>
            )}
          </div>
        </div>
        {/* Gold accent bar */}
        <div style={{ height: 3, background: `linear-gradient(90deg, ${C.gold}, ${C.red}, ${C.gold})` }} />
      </header>

      {/* ================================================================== */}
      {/* MAIN CONTENT                                                        */}
      {/* ================================================================== */}
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px 60px" }}>

        {/* Welcome banner (only before interview starts) */}
        {!question && !showStoryPanel && (
          <Card accentColor={C.gold} style={{ marginBottom: 24, background: `linear-gradient(135deg, ${C.navy}08, ${C.gold}12)` }}>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ fontSize: 36, lineHeight: 1 }}>🎓</div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontWeight: "700", fontSize: 18, color: C.navy, marginBottom: 6 }}>
                  Welcome to the CPL Story Interview
                </div>
                <div style={{ color: C.textMid, fontSize: 14, lineHeight: 1.65 }}>
                  Your experience matters. This interview captures your Credit for Prior Learning (CPL) story —
                  how your work, military service, or training was recognized for college credit.
                  There are no wrong answers. Just share your journey in your own words.
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: C.textLight }}>
                  Takes about 10–15 minutes · Six topic areas · Voice or typed answers
                </div>

                {/* Stories teaser */}
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 14px",
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderLeft: `4px solid ${C.gold}`,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 20 }}>💬</span>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: "600", fontSize: 13, color: C.navy }}>
                      Curious what other students have shared?
                    </div>
                    <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>
                      Real CPL success stories from working adults and veterans across California.
                    </div>
                  </div>
                  <a
                    href="https://map.rccd.edu/mycplstory/"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: C.navy,
                      color: C.white,
                      fontWeight: "700",
                      fontSize: 12,
                      padding: "7px 14px",
                      borderRadius: 8,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Read CPL Stories →
                  </a>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Progress bar (shown when interview is active or complete) */}
        {(question || status) && (
          <Card style={{ padding: "16px 20px 8px", marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: C.textLight, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
              Interview Progress
            </div>
            <ProgressBar currentSection={section} status={status} />
          </Card>
        )}

        {/* ---- Error / Message banners ---- */}
        {error && (
          <div
            role="alert"
            style={{
              padding: "12px 16px",
              background: C.errorBg,
              border: `1px solid ${C.errorBorder}`,
              borderLeft: `4px solid ${C.red}`,
              borderRadius: 10,
              marginBottom: 16,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
            <div>
              <strong style={{ color: C.red }}>Error</strong>
              <div style={{ marginTop: 2, color: C.textDark, fontSize: 14 }}>{error}</div>
            </div>
          </div>
        )}

        {msg && (
          <div
            role="status"
            style={{
              padding: "12px 16px",
              background: C.greenLight,
              border: `1px solid ${C.greenBorder}`,
              borderLeft: `4px solid ${C.green}`,
              borderRadius: 10,
              marginBottom: 16,
              display: "flex",
              gap: 10,
              alignItems: "center",
              fontSize: 14,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>✅</span>
            <span>{msg}</span>
          </div>
        )}

        {/* ================================================================ */}
        {/* SESSION PANEL                                                     */}
        {/* ================================================================ */}
        <Card accentColor={C.navy}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px" }}>
              <label htmlFor="session-id-input" style={{ display: "block", fontSize: 12, fontWeight: "600", color: C.textMid, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Session ID
              </label>
              <input
                id="session-id-input"
                aria-label="Session ID"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: "monospace",
                  boxSizing: "border-box",
                  background: C.white,
                  color: C.textDark,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 20 }}>
              <Btn
                onClick={startInterview}
                disabled={loading || !sessionId}
                variant="primary"
                ariaLabel="Start interview session"
              >
                {status ? "↺ Restart Interview" : "▶ Start Interview"}
              </Btn>
              <Btn
                onClick={() => refreshSession()}
                disabled={loading || !sessionId}
                variant="ghost"
                ariaLabel="Refresh session from backend"
              >
                🔄 Refresh
              </Btn>
            </div>
          </div>

          {/* Status ribbon */}
          {status && (
            <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap", fontSize: 13 }}>
              {[
                ["Status", status],
                ["Section", section || "—"],
                ["Turn", turn ?? "—"],
                ["Decision", decision || "—"],
              ].map(([label, val]) => (
                <div key={label}>
                  <span style={{ color: C.textLight, fontWeight: "600", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label} </span>
                  <span
                    style={{
                      background: label === "Status" && status === "complete" ? C.greenLight : C.offWhite,
                      color: label === "Status" && status === "complete" ? C.green : C.navy,
                      border: `1px solid ${C.border}`,
                      borderRadius: 5,
                      padding: "2px 8px",
                      fontWeight: "600",
                      fontSize: 12,
                    }}
                  >
                    {String(val)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ================================================================ */}
        {/* INTERVIEW PANEL                                                   */}
        {/* ================================================================ */}
        <Card accentColor={C.navy}>
          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div
              style={{
                background: C.navy,
                color: C.white,
                borderRadius: 8,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: "700",
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              {section || "Interview"}
            </div>
            {turn != null && (
              <div style={{ fontSize: 13, color: C.textLight }}>
                Turn <strong>{turn}</strong>
              </div>
            )}
          </div>

          {/* Section guidance */}
          {section && SECTION_GUIDANCE[section] && (
            <div
              style={{
                background: `${C.navy}0a`,
                border: `1px solid ${C.navy}22`,
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 14,
                fontSize: 13,
                color: C.navy,
                lineHeight: 1.55,
              }}
            >
              <strong style={{ color: C.navy }}>Guidance:</strong> {SECTION_GUIDANCE[section]}
            </div>
          )}

          {/* Current question */}
          <div
            style={{
              padding: 16,
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              marginBottom: 14,
              boxShadow: "inset 0 1px 4px rgba(27,58,107,0.05)",
            }}
          >
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 8, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" }}>
              Question
            </div>
            <div style={{ fontSize: 17, lineHeight: 1.55, color: C.textDark, fontWeight: "500" }}>
              {question || (
                <span style={{ color: C.textLight, fontStyle: "italic" }}>
                  Click "▶ Start Interview" above to receive your first question.
                </span>
              )}
            </div>
          </div>

          {/* Agent reflection */}
          {reflection && (
            <div
              style={{
                padding: "10px 14px",
                background: `${C.gold}18`,
                border: `1px solid ${C.gold}55`,
                borderRadius: 10,
                marginBottom: 14,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 4, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" }}>
                Interviewer Note
              </div>
              <div style={{ color: C.textDark }}>{reflection}</div>
            </div>
          )}

          {/* Answer textarea */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label htmlFor="answer-textarea" style={{ fontSize: 12, fontWeight: "600", color: C.textMid, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Your Answer
              </label>
              <span
                style={{
                  fontSize: 12,
                  color: answer.length > MAX_ANSWER_LEN ? C.red : C.textLight,
                  fontWeight: answer.length > MAX_ANSWER_LEN ? "700" : "400",
                }}
              >
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
              style={{
                width: "100%",
                padding: 12,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                boxSizing: "border-box",
                fontSize: 14,
                lineHeight: 1.55,
                resize: "vertical",
                fontFamily: "inherit",
                color: C.textDark,
                background: C.white,
                outline: `2px solid transparent`,
                transition: "border-color 0.2s",
              }}
              placeholder="Type your answer here, or use voice recording below…"
            />
          </div>

          {/* Action buttons row */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Btn
              onClick={submitAnswer}
              disabled={!canSubmitAnswer}
              variant="primary"
              ariaLabel="Submit typed answer"
            >
              Submit Answer
            </Btn>

            <Btn
              onClick={startRecording}
              disabled={loading || isUploading || !sessionId || !question || isRecording}
              variant={isRecording ? "recording" : "ghost"}
              ariaLabel="Start voice recording"
            >
              🎙 {isRecording ? "Recording…" : "Start Recording"}
            </Btn>

            <Btn
              onClick={stopRecording}
              disabled={!isRecording}
              variant="ghost"
              ariaLabel="Stop voice recording"
            >
              ⏹ Stop
            </Btn>

            <Btn
              onClick={uploadTranscribeAndSubmitVoice}
              disabled={isUploading || !recordedBlob || turn == null}
              variant="outline"
              ariaLabel="Upload, transcribe, and submit voice answer"
            >
              {isUploading ? "Uploading…" : "⬆️ Submit Voice"}
            </Btn>

            <Btn
              onClick={finishInterview}
              disabled={loading}
              variant="ghost"
              ariaLabel="Finish interview"
            >
              Finish Interview
            </Btn>
          </div>

          {/* Recording status */}
          {isRecording && (
            <div
              role="status"
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: C.red,
                fontWeight: "700",
                fontSize: 14,
              }}
            >
              <span style={{ animation: "pulse 1s infinite", fontSize: 16 }}>●</span>
              Recording in progress — speak clearly and naturally
            </div>
          )}

          {isUploading && (
            <div role="status" style={{ marginTop: 10, color: C.textMid, fontSize: 13 }}>
              ⏳ Uploading and transcribing voice answer…
            </div>
          )}

          {/* Transcript display */}
          {transcript && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: C.offWhite,
              }}
            >
              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Voice Transcript
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.55 }}>{transcript}</div>
            </div>
          )}
        </Card>

        {/* ================================================================ */}
        {/* STORY PANEL                                                       */}
        {/* ================================================================ */}
        {showStoryPanel && (
          <Card accentColor={C.red}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  background: C.red,
                  color: C.white,
                  borderRadius: 8,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: "700",
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                Your Story
              </div>
              <div style={{ fontSize: 13, color: C.textLight }}>
                Draft → Edit → Approve &amp; Lock → Photo
              </div>
            </div>

            {/* Story action buttons */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <Btn
                onClick={generateDraft}
                disabled={!canGenerateDraft}
                variant="primary"
                ariaLabel="Generate AI story draft"
              >
                ✨ Generate Draft
              </Btn>

              <Btn
                onClick={quickFillDemoDraft}
                disabled={loading || isLocked}
                variant="ghost"
                ariaLabel="Insert demo draft"
              >
                Quick Fill Demo
              </Btn>

              <Btn
                onClick={saveEdits}
                disabled={!canSaveEdits}
                variant="outline"
                ariaLabel="Save story edits"
              >
                💾 Save Edits
              </Btn>

              <Btn
                onClick={() => approveStory(true)}
                disabled={!canApprove}
                variant="gold"
                ariaLabel="Approve and lock story, then add photo"
              >
                🔒 Approve &amp; Lock (+ Photo)
              </Btn>

              <Btn
                onClick={() => approveStory(false)}
                disabled={!canApprove}
                variant="outline"
                ariaLabel="Approve and lock story, skip photo"
              >
                🔒 Approve &amp; Lock (No Photo)
              </Btn>

              <Btn
                onClick={() => loadPublishPreview()}
                disabled={loading || !sessionId}
                variant="ghost"
                ariaLabel="Load publish preview"
              >
                👁 Preview
              </Btn>
            </div>

            {/* Status row */}
            <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap", fontSize: 13 }}>
              {[
                ["Approval", approvalStatus || "—"],
                ["Photo", photoStatus || "—"],
                ["Draft version", storyDraftVersion ?? "—"],
              ].map(([label, val]) => (
                <div key={label}>
                  <span style={{ color: C.textLight, fontWeight: "600", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label} </span>
                  <span
                    style={{
                      background: C.offWhite,
                      border: `1px solid ${C.border}`,
                      borderRadius: 5,
                      padding: "2px 8px",
                      fontWeight: "600",
                      fontSize: 12,
                      color: C.navy,
                    }}
                  >
                    {String(val)}
                  </span>
                </div>
              ))}
            </div>

            {/* Locked notice */}
            {isLocked && (
              <div
                style={{
                  padding: "10px 14px",
                  background: C.warnBg,
                  border: `1px solid ${C.warnBorder}`,
                  borderLeft: `4px solid ${C.gold}`,
                  borderRadius: 8,
                  marginBottom: 14,
                  fontSize: 13,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                🔒 <strong>Story is approved and locked.</strong> The editor below is read-only.
              </div>
            )}

            {/* Story editor + char counter */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label htmlFor="story-editor" style={{ fontSize: 12, fontWeight: "600", color: C.textMid, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {isLocked ? "Story (locked — read-only)" : "Story Editor"}
                </label>
                <span
                  style={{
                    fontSize: 12,
                    color: editedText.length > MAX_STORY_LEN ? C.red : C.textLight,
                  }}
                >
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
                  padding: 14,
                  border: `1px solid ${isLocked ? C.warnBorder : C.border}`,
                  borderRadius: 10,
                  boxSizing: "border-box",
                  background: isLocked ? "#fffef7" : C.white,
                  cursor: isLocked ? "not-allowed" : "text",
                  fontSize: 14,
                  lineHeight: 1.65,
                  fontFamily: "Georgia, serif",
                  resize: "vertical",
                }}
                placeholder='Click "✨ Generate Draft" or use "Quick Fill Demo"…'
              />
            </div>

            {/* Approved story preview */}
            {approvedText ? (
              <div
                style={{
                  padding: 14,
                  background: "#f0faf5",
                  border: `1px solid ${C.greenBorder}`,
                  borderLeft: `4px solid ${C.green}`,
                  borderRadius: 10,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Approved Story (locked)
                </div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 14, lineHeight: 1.65, fontFamily: "Georgia, serif" }}>{approvedText}</pre>
              </div>
            ) : null}

            {/* ============================================================ */}
            {/* PHOTO SECTION                                                 */}
            {/* ============================================================ */}
            {showPhotoPanel && (
              <div
                style={{
                  borderTop: `2px solid ${C.border}`,
                  paddingTop: 18,
                  marginTop: 4,
                }}
              >
                <div style={{ fontWeight: "700", fontSize: 15, color: C.navy, marginBottom: 4 }}>
                  📷 Photo (Optional)
                </div>
                <div style={{ fontSize: 13, color: C.textMid, marginBottom: 14 }}>
                  Add a profile photo to go alongside your story. This is completely optional.
                </div>

                {/* Consent checkboxes */}
                <div style={{ display: "flex", gap: 20, marginBottom: 14, flexWrap: "wrap" }}>
                  {[
                    [photoConsentPdf, setPhotoConsentPdf, "consent-pdf", "Include photo in PDF document"],
                    [photoConsentPublish, setPhotoConsentPublish, "consent-publish", "Include photo for online publishing"],
                  ].map(([checked, setter, id, labelText]) => (
                    <label
                      key={id}
                      htmlFor={id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        cursor: "pointer",
                        padding: "8px 12px",
                        border: `1px solid ${checked ? C.navy : C.border}`,
                        borderRadius: 8,
                        background: checked ? `${C.navy}0a` : C.white,
                        transition: "all 0.2s",
                      }}
                    >
                      <input
                        type="checkbox"
                        id={id}
                        aria-label={labelText}
                        checked={checked}
                        onChange={(e) => setter(e.target.checked)}
                        style={{ accentColor: C.navy, width: 16, height: 16 }}
                      />
                      <span style={{ color: C.textDark }}>{labelText}</span>
                    </label>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <Btn
                    onClick={getPhotoUploadUrl}
                    disabled={loading || !sessionId}
                    variant="outline"
                    ariaLabel="Get photo upload URL"
                  >
                    Get Upload URL
                  </Btn>
                  <Btn
                    onClick={skipPhoto}
                    disabled={loading || !sessionId}
                    variant="ghost"
                    ariaLabel="Skip photo upload"
                  >
                    Skip Photo
                  </Btn>
                </div>

                {photoUploadUrl ? (
                  <div
                    style={{
                      padding: 14,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      marginBottom: 12,
                      background: C.offWhite,
                    }}
                  >
                    <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8, fontWeight: "600" }}>
                      Choose JPEG photo (max {MAX_PHOTO_MB} MB)
                    </div>
                    <input
                      type="file"
                      accept="image/jpeg"
                      aria-label="Choose JPEG photo file"
                      onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                      style={{ fontSize: 13 }}
                    />
                    {photoFile && (
                      <div style={{ marginTop: 8, fontSize: 12, color: C.textMid }}>
                        <strong>{photoFile.name}</strong> ({(photoFile.size / 1024 / 1024).toFixed(2)} MB)
                        {!photoFile.type.startsWith("image/jpeg") && (
                          <span style={{ color: C.red, marginLeft: 8 }}>⚠ Must be JPEG</span>
                        )}
                        {photoFile.size > MAX_PHOTO_MB * 1024 * 1024 && (
                          <span style={{ color: C.red, marginLeft: 8 }}>⚠ Too large (max {MAX_PHOTO_MB} MB)</span>
                        )}
                      </div>
                    )}
                    <div style={{ marginTop: 10 }}>
                      <Btn
                        onClick={uploadPhotoAndSubmit}
                        disabled={loading || !photoFile}
                        variant="primary"
                        ariaLabel="Upload photo and confirm with backend"
                      >
                        Upload Photo
                      </Btn>
                    </div>
                    {photoUploadObjectName && (
                      <div style={{ marginTop: 8, fontSize: 11, color: C.textLight }}>
                        Object: <code>{photoUploadObjectName}</code>
                      </div>
                    )}
                  </div>
                ) : null}

                {photoStatus === "uploaded" && photoObject && (
                  <div
                    style={{
                      padding: "10px 14px",
                      background: C.greenLight,
                      border: `1px solid ${C.greenBorder}`,
                      borderRadius: 10,
                      fontSize: 13,
                    }}
                  >
                    ✅ Photo uploaded: <code style={{ fontSize: 11 }}>{photoObject}</code>
                  </div>
                )}

                {photoStatus === "skipped" && (
                  <div
                    style={{
                      padding: "10px 14px",
                      background: C.offWhite,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      fontSize: 13,
                      color: C.textMid,
                    }}
                  >
                    Photo skipped — your story will be published without a photo.
                  </div>
                )}
              </div>
            )}

            {/* ============================================================ */}
            {/* PUBLISH PREVIEW                                               */}
            {/* ============================================================ */}
            {shouldShowPublishPreview && (
              <div
                style={{
                  borderTop: `2px solid ${C.border}`,
                  paddingTop: 18,
                  marginTop: 18,
                }}
              >
                <div style={{ fontWeight: "700", fontSize: 15, color: C.navy, marginBottom: 4 }}>
                  👁 Publish Preview
                </div>
                <div style={{ fontSize: 13, color: C.textMid, marginBottom: 16 }}>
                  Review how your story will appear when published. When you are satisfied, click the submit button below.
                </div>

                <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {/* Photo column */}
                  <div style={{ minWidth: 200, maxWidth: 280 }}>
                    <div style={{ fontSize: 11, color: C.textLight, marginBottom: 8, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Photo
                    </div>
                    {(photoStatus || "").toLowerCase() === "uploaded" ? (
                      photoPreviewUrl ? (
                        <img
                          src={photoPreviewUrl}
                          alt="Student photo preview"
                          style={{ width: "100%", borderRadius: 12, border: `2px solid ${C.border}`, boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}
                        />
                      ) : (
                        <div style={{ padding: 12, border: `1px dashed ${C.border}`, borderRadius: 10, fontSize: 13, color: C.textLight }}>
                          No preview URL yet. Click "👁 Preview".
                        </div>
                      )
                    ) : (
                      <div style={{ padding: 12, border: `1px dashed ${C.border}`, borderRadius: 10, fontSize: 13, color: C.textLight }}>
                        No photo included.
                      </div>
                    )}
                  </div>

                  {/* Story text column */}
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{ fontSize: 11, color: C.textLight, marginBottom: 8, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Final Story
                    </div>
                    <div
                      style={{
                        padding: 16,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        background: C.white,
                        boxShadow: "0 2px 8px rgba(27,58,107,0.06)",
                      }}
                    >
                      <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 14, lineHeight: 1.7, fontFamily: "Georgia, serif" }}>
                        {finalSto
