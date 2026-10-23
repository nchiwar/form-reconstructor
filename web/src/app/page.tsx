"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  FileText,
  Camera,
  Sparkles,
  CheckCircle2,
  Download,
  Loader2,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  PlusCircle,
  Clock,
  AlertCircle,
  Layers,
  ShieldCheck,
  Wand2,
  Trash2,
  Share2,
  FileSpreadsheet,
  FileType2,
  QrCode,
  BookmarkPlus,
  Move,
  PenTool,
  ExternalLink,
  X,
  Palette,
  Type,
} from "lucide-react";

interface ExtractedField {
  page_num: number;
  field_label: string;
  handwritten_value: string;
  field_type: string;
  box_2d: number[];
  offset_x: number;
  offset_y: number;
  font_size: number;
}

interface RecentDocument {
  id: string;
  blankName: string;
  scanName: string;
  fieldCount: number;
  pageCount: number;
  date: string;
}

interface SavedTemplate {
  id: string;
  name: string;
  filename: string;
  pages: number;
}

type ScreenStep =
  | "welcome"
  | "dashboard"
  | "upload_blank"
  | "upload_scan"
  | "verify"
  | "download";

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

export default function FormReconstructorApp() {
  const [currentScreen, setCurrentScreen] = useState<ScreenStep>("welcome");

  // Form & Multi-page states
  const [blankPdf, setBlankPdf] = useState<File | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<SavedTemplate | null>(null);
  const [scannedImages, setScannedImages] = useState<File[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number>(1);
  const [activePreviewPage, setActivePreviewPage] = useState<number>(0);
  const [selectedFieldIdx, setSelectedFieldIdx] = useState<number | null>(null);

  // Typography & Ink Customization
  const [inkColor, setInkColor] = useState<string>("navy");
  const [fontFamily, setFontFamily] = useState<string>("helv");

  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfDownloadUrl, setPdfDownloadUrl] = useState<string | null>(null);
  const [activeDocTitle, setActiveDocTitle] = useState<string>("reconstructed_form.pdf");

  // Loading & Status states
  const [isExtracting, setIsExtracting] = useState(false);
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [isOpeningRecent, setIsOpeningRecent] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Dashboard states
  const [recentDocs, setRecentDocs] = useState<RecentDocument[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("form_reconstructor_recents");
    if (saved) {
      try {
        setRecentDocs(JSON.parse(saved));
      } catch {
        setRecentDocs([]);
      }
    }
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/templates`);
      setSavedTemplates(res.data.templates || []);
    } catch {
      // Ignore if backend is offline
    }
  };

  const saveToRecents = (
    id: string,
    bName: string,
    sName: string,
    count: number,
    pages: number
  ) => {
    const newEntry: RecentDocument = {
      id,
      blankName: bName,
      scanName: sName,
      fieldCount: count,
      pageCount: pages,
      date: new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    const filtered = recentDocs.filter((d) => d.id !== id);
    const updated = [newEntry, ...filtered.slice(0, 14)];
    setRecentDocs(updated);
    localStorage.setItem("form_reconstructor_recents", JSON.stringify(updated));
  };

  const clearHistory = () => {
    setRecentDocs([]);
    localStorage.removeItem("form_reconstructor_recents");
  };

  // Click on any Recent Upload on the Dashboard to open its PDF & session data
  const handleOpenRecentDocument = async (doc: RecentDocument) => {
    setError(null);
    setIsOpeningRecent(doc.id);
    try {
      // 1. Fetch the saved reconstructed PDF blob
      const pdfRes = await axios.get(`${API_URL}/api/export/${doc.id}/pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([pdfRes.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);

      // 2. Also load the saved session metadata so the user can re-edit fields if desired
      try {
        const metaRes = await axios.get(`${API_URL}/api/session/${doc.id}`);
        setFields(metaRes.data.fields || []);
        setPageCount(metaRes.data.page_count || doc.pageCount || 1);
      } catch {
        setFields([]);
      }

      setSessionId(doc.id);
      setPdfBlob(blob);
      setPdfDownloadUrl(url);
      setActiveDocTitle(doc.blankName);
      setActivePreviewPage(0);
      setCurrentScreen("download");
    } catch {
      setError(
        "Could not open this document from the server. Its temporary files may have been cleared."
      );
    } finally {
      setIsOpeningRecent(null);
    }
  };

  const startNewWorkflow = () => {
    setBlankPdf(null);
    setSelectedTemplate(null);
    setScannedImages([]);
    setSessionId(null);
    setFields([]);
    setPdfDownloadUrl(null);
    setPdfBlob(null);
    setError(null);
    setCurrentScreen("upload_blank");
  };

  const startWithSavedTemplate = (tpl: SavedTemplate) => {
    setSelectedTemplate(tpl);
    setBlankPdf(null);
    setScannedImages([]);
    setSessionId(null);
    setFields([]);
    setPdfDownloadUrl(null);
    setError(null);
    setCurrentScreen("upload_scan");
  };

  // Multi-Document / Multi-Page Scan Queue Helpers (Add, Reorder Up/Down, Remove)
  const handleAppendScans = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const newlySelected = Array.from(e.target.files || []);
    if (newlySelected.length > 0) {
      setScannedImages((prev) => [...prev, ...newlySelected]);
    }
    e.target.value = "";
  };

  const moveScanPage = (index: number, direction: "up" | "down") => {
    const updated = [...scannedImages];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= updated.length) return;
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setScannedImages(updated);
  };

  const removeScanPage = (index: number) => {
    setScannedImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Save current Blank PDF to the reusable Template Library
  const handleSaveAsTemplate = async () => {
    if (!blankPdf) return;
    setIsSavingTemplate(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("name", templateNameInput.trim() || blankPdf.name);
      formData.append("blank_pdf", blankPdf);
      const res = await axios.post(`${API_URL}/api/templates`, formData);
      await fetchTemplates();
      setSelectedTemplate(res.data);
      setTemplateNameInput("");
    } catch {
      setError("Could not save template to library.");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  // Download Smart QR / Fiducial Print PDF
  const handleDownloadSmartQrPdf = async () => {
    if (!blankPdf) return;
    try {
      const formData = new FormData();
      formData.append("blank_pdf", blankPdf);
      const res = await axios.post(`${API_URL}/api/prepare-qr-pdf`, formData, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `smart_print_${blankPdf.name}`;
      a.click();
    } catch {
      setError("Failed to generate Smart Print PDF.");
    }
  };

  // Extract Handwriting across all arranged scan pages
  const handleExtract = async () => {
    if ((!blankPdf && !selectedTemplate) || scannedImages.length === 0) {
      setError("Please attach the blank form and at least one scanned page photo.");
      return;
    }

    setError(null);
    setIsExtracting(true);

    try {
      const formData = new FormData();
      if (selectedTemplate) {
        formData.append("template_id", selectedTemplate.id);
      } else if (blankPdf) {
        formData.append("blank_pdf", blankPdf);
      }

      scannedImages.forEach((img) => {
        formData.append("scanned_images", img);
      });

      const response = await axios.post(`${API_URL}/api/extract`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setSessionId(response.data.session_id);
      setPageCount(response.data.page_count || scannedImages.length);
      setFields(response.data.fields || []);
      setActivePreviewPage(0);
      setCurrentScreen("verify");
    } catch (err: any) {
      setError(
        err.response?.data?.detail ||
          "Failed to extract form fields. Make sure your FastAPI server is running on port 8000."
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const updateField = (index: number, patch: Partial<ExtractedField>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...patch };
    setFields(updated);
  };

  const formatAllFieldsCase = (mode: "upper" | "title") => {
    const updated = fields.map((f) => {
      if (f.field_type !== "text") return f;
      const val = f.handwritten_value;
      return {
        ...f,
        handwritten_value:
          mode === "upper"
            ? val.toUpperCase()
            : val.replace(
                /\w\S*/g,
                (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
              ),
      };
    });
    setFields(updated);
  };

  // Reconstruct Clean PDF + Word + Excel
  const handleReconstruct = async () => {
    if (!sessionId) return;

    setError(null);
    setIsReconstructing(true);

    try {
      const response = await axios.post(
        `${API_URL}/api/reconstruct`,
        {
          session_id: sessionId,
          template_id: selectedTemplate?.id || null,
          ink_color: inkColor,
          font_family: fontFamily,
          fields: fields,
        },
        { responseType: "blob" }
      );

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const docTitle =
        selectedTemplate?.name || blankPdf?.name || activeDocTitle || "Blank_Form.pdf";

      setPdfBlob(blob);
      setPdfDownloadUrl(url);
      setActiveDocTitle(docTitle);

      saveToRecents(
        sessionId,
        docTitle,
        scannedImages.length > 0
          ? `${scannedImages.length} arranged page(s)`
          : `${pageCount} page(s)`,
        fields.length,
        pageCount
      );

      setCurrentScreen("download");
    } catch {
      setError("Failed to reconstruct the clean PDF. Please try again.");
    } finally {
      setIsReconstructing(false);
    }
  };

  // Native Web Share API
  const handleShareDocument = async () => {
    if (!pdfBlob) return;
    const fileName = `clean_${activeDocTitle.replace(/\s+/g, "_")}`;
    const file = new File([pdfBlob], fileName, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: "Reconstructed Clean Form",
          text: "Here is the clean digital PDF reconstructed from the handwritten scan.",
          files: [file],
        });
        return;
      } catch {
        // Cancelled by user
      }
    } else if (pdfDownloadUrl) {
      alert(
        "Direct file sharing is supported on mobile browsers and compatible desktop browsers. Use the Download buttons to save your file."
      );
    }
  };

  const wizardSteps: { key: ScreenStep; label: string }[] = [
    { key: "upload_blank", label: "1. Blank PDF" },
    { key: "upload_scan", label: "2. Arrange Scans" },
    { key: "verify", label: "3. Verify & Style" },
    { key: "download", label: "4. Export & Share" },
  ];

  const isWizardStep = ["upload_blank", "upload_scan", "verify", "download"].includes(
    currentScreen
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col py-8 px-4 sm:px-6 lg:px-8">
      {/* Top Navbar */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between border-b border-slate-200 pb-5">
        <button
          onClick={() => setCurrentScreen("welcome")}
          className="flex items-center gap-2.5 text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-indigo-600 group-hover:scale-110 transition" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight text-slate-900 block leading-none">
              FormReconstruct
            </span>
            <span className="text-[11px] text-slate-500">
              Physical-to-Digital PDF Studio
            </span>
          </div>
        </button>

        {currentScreen !== "welcome" && (
          <button
            onClick={() => setCurrentScreen("dashboard")}
            className="px-4 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 shadow-sm transition"
          >
            Dashboard
          </button>
        )}
      </header>

      {/* Main Content Container */}
      <div className="max-w-4xl w-full mx-auto my-auto py-8">
        {/* Step Progress Pills */}
        {isWizardStep && (
          <div className="flex items-center justify-center gap-2 sm:gap-4 mb-8 flex-wrap">
            {wizardSteps.map((step, index) => {
              const currentIndex = wizardSteps.findIndex((s) => s.key === currentScreen);
              const isActive = step.key === currentScreen;
              const isCompleted = index < currentIndex;

              return (
                <div
                  key={step.key}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                    isActive
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                      : isCompleted
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-white text-slate-400 border-slate-200"
                  }`}
                >
                  {step.label}
                </div>
              );
            })}
          </div>
        )}

        {/* Global Error Banner */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center gap-3 text-red-700 text-center shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* =========================================================
            SCREEN 1: WELCOME SCREEN
        ========================================================= */}
        {currentScreen === "welcome" && (
          <div className="text-center space-y-8 py-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold">
              <Wand2 className="w-3.5 h-3.5" />
              Physical-to-Digital Reconstruction • PDF, Word & Excel
            </div>

            <div className="space-y-4 max-w-2xl mx-auto">
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
                Turn Handwritten Scans Into{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-emerald-600">
                  Crisp Digital Documents
                </span>
              </h1>
              <p className="text-slate-600 text-base sm:text-lg leading-relaxed">
                Print your form, fill it out by hand, and snap photos of as many pages
                as you have. We arrange, align, lift real signatures, and stamp clean
                digital text onto your PDF—or export straight to Word and Excel.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left pt-2">
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <Layers className="w-6 h-6 text-indigo-600 mb-2.5" />
                <h3 className="font-semibold text-slate-900 text-sm">
                  Unlimited Page Organizer
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Upload 3, 5, or 10+ scanned pages, reorder them cleanly, and merge into one crisp document.
                </p>
              </div>
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <PenTool className="w-6 h-6 text-emerald-600 mb-2.5" />
                <h3 className="font-semibold text-slate-900 text-sm">
                  Real Ink Signature Lifting
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Extracts handwritten signatures and stamps with transparent backgrounds onto the clean PDF.
                </p>
              </div>
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <ShieldCheck className="w-6 h-6 text-amber-600 mb-2.5" />
                <h3 className="font-semibold text-slate-900 text-sm">
                  PDF, Word, Excel & Share
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Click any recent document on your dashboard to view, re-edit, export, or share anytime.
                </p>
              </div>
            </div>

            <div className="flex justify-center pt-4">
              <button
                onClick={() => setCurrentScreen("dashboard")}
                className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-base shadow-lg shadow-indigo-600/20 transition transform hover:-translate-y-0.5"
              >
                Get Started
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            SCREEN 2: DASHBOARD (CLICKABLE RECENT UPLOADS & TEMPLATES)
        ========================================================= */}
        {currentScreen === "dashboard" && (
          <div className="space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-bold text-slate-900">Your Form Dashboard</h2>
              <p className="text-sm text-slate-600">
                Start a new reconstruction, pick a saved template, or click any recent document to open it.
              </p>
            </div>

            {/* Centered Primary Action Button */}
            <div className="flex justify-center">
              <button
                onClick={startNewWorkflow}
                className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-base shadow-md shadow-indigo-600/15 transition"
              >
                <PlusCircle className="w-5 h-5" />
                Reconstruct a New Form
              </button>
            </div>

            {/* Saved Form Templates Library */}
            <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <BookmarkPlus className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Saved Form Templates (1-Click Scan Mode)
                  </h3>
                </div>
                <span className="text-xs text-slate-400">
                  Skip uploading the blank PDF every time
                </span>
              </div>

              {savedTemplates.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">
                  No saved templates yet. When uploading a blank PDF in Step 1, click &ldquo;Save to Library&rdquo; to reuse it anytime.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {savedTemplates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">{tpl.name}</p>
                        <p className="text-xs text-slate-500">
                          {tpl.filename} • {tpl.pages} page(s)
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                        <button
                          onClick={() => startWithSavedTemplate(tpl)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition"
                        >
                          Scan Filled Form
                        </button>
                        <a
                          href={`${API_URL}/api/templates/${tpl.id}/qr-pdf`}
                          className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition"
                        >
                          QR Print PDF
                        </a>
                        <a
                          href={`${API_URL}/api/templates/${tpl.id}/master-excel`}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold transition"
                        >
                          Master Excel
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Clickable Recent Uploads Section */}
            <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Recent Reconstructed Documents (Click to Open)
                  </h3>
                </div>
                {recentDocs.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear History
                  </button>
                )}
              </div>

              {recentDocs.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <FileText className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-medium text-slate-600">
                    No forms reconstructed yet.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentDocs.map((doc) => {
                    const isLoadingThis = isOpeningRecent === doc.id;
                    return (
                      <div
                        key={doc.id}
                        onClick={() => handleOpenRecentDocument(doc)}
                        className="py-3.5 px-3 -mx-3 rounded-xl hover:bg-indigo-50/50 cursor-pointer transition flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 group"
                      >
                        <div className="space-y-0.5">
                          <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 flex items-center gap-2 transition">
                            {isLoadingThis ? (
                              <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                            )}
                            {doc.blankName}
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition" />
                          </p>
                          <p className="text-xs text-slate-500 pl-6">
                            Processed:{" "}
                            <span className="text-slate-700 font-medium">{doc.scanName}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-3 pl-6 sm:pl-0">
                          <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                            {doc.fieldCount} fields
                          </span>
                          <span className="text-xs text-slate-400">{doc.date}</span>
                          <span className="text-xs font-semibold text-indigo-600 group-hover:underline">
                            Open Document →
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================
            SCREEN 3: UPLOAD ORIGINAL BLANK FORM (PDF)
        ========================================================= */}
        {currentScreen === "upload_blank" && (
          <div className="rounded-3xl bg-white border border-slate-200 p-8 space-y-8 text-center shadow-sm">
            <div className="space-y-2 max-w-lg mx-auto">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                Step 1 of 4
              </span>
              <h2 className="text-2xl font-bold text-slate-900">
                Attach the Original Blank Form (PDF)
              </h2>
              <p className="text-sm text-slate-600">
                Upload single or multi-page blank PDF forms. You can also generate a
                Smart Corner-Anchored PDF before printing or save it as a reusable template.
              </p>
            </div>

            <label className="max-w-lg mx-auto flex flex-col items-center justify-center p-10 border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl bg-slate-50/70 hover:bg-indigo-50/30 cursor-pointer transition">
              <FileText className="w-14 h-14 text-indigo-600 mb-4" />
              <span className="text-base font-semibold text-slate-900">
                {blankPdf ? blankPdf.name : "Click to select your Blank PDF"}
              </span>
              <span className="text-xs text-slate-500 mt-1.5">
                {blankPdf
                  ? `${(blankPdf.size / 1024).toFixed(1)} KB • Ready`
                  : "Supports single or multi-page PDF documents (.pdf)"}
              </span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  setError(null);
                  setSelectedTemplate(null);
                  setBlankPdf(e.target.files?.[0] || null);
                }}
              />
            </label>

            {blankPdf && (
              <div className="max-w-lg mx-auto p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                  <input
                    type="text"
                    placeholder="Optional template name (e.g. Loan Form)"
                    value={templateNameInput}
                    onChange={(e) => setTemplateNameInput(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs text-slate-900 w-full sm:w-64"
                  />
                  <button
                    onClick={handleSaveAsTemplate}
                    disabled={isSavingTemplate}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold transition"
                  >
                    <BookmarkPlus className="w-4 h-4" />
                    {isSavingTemplate ? "Saving..." : "Save to Library"}
                  </button>
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={handleDownloadSmartQrPdf}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition"
                  >
                    <QrCode className="w-4 h-4 text-indigo-600" />
                    Download Smart Corner-Marker PDF for Printing
                  </button>
                </div>
              </div>
            )}

            {/* Centered Navigation Buttons */}
            <div className="flex items-center justify-center gap-4 pt-2 flex-wrap">
              <button
                onClick={() => setCurrentScreen("dashboard")}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </button>

              <button
                onClick={() => {
                  if (!blankPdf && !selectedTemplate) {
                    setError("Please select your original blank PDF first.");
                    return;
                  }
                  setError(null);
                  setCurrentScreen("upload_scan");
                }}
                disabled={!blankPdf && !selectedTemplate}
                className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm shadow-md shadow-indigo-600/15 transition"
              >
                Next: Upload & Arrange Scans
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            SCREEN 4: UPLOAD & ARRANGE UNLIMITED HANDWRITTEN SCANS
        ========================================================= */}
        {currentScreen === "upload_scan" && (
          <div className="rounded-3xl bg-white border border-slate-200 p-8 space-y-8 text-center shadow-sm">
            <div className="space-y-2 max-w-xl mx-auto">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                Step 2 of 4
              </span>
              <h2 className="text-2xl font-bold text-slate-900">
                Upload & Arrange Handwritten Scans
              </h2>
              <p className="text-sm text-slate-600">
                Upload 1, 3, 5, or more scanned photos for{" "}
                <span className="text-slate-900 font-semibold">
                  {selectedTemplate?.name || blankPdf?.name}
                </span>
                . Use the arrow buttons below to arrange their exact page order.
              </p>
            </div>

            {/* Dropzone to Add / Append More Scan Files */}
            <label className="max-w-lg mx-auto flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl bg-slate-50/70 hover:bg-emerald-50/30 cursor-pointer transition">
              <Camera className="w-12 h-12 text-emerald-600 mb-3" />
              <span className="text-base font-semibold text-slate-900">
                {scannedImages.length > 0
                  ? "Click to Add More Scanned Pages (+)"
                  : "Click to Select Your Handwritten Scan(s)"}
              </span>
              <span className="text-xs text-slate-500 mt-1">
                Select as many JPG/PNG photos as you need—you can reorder them below
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleAppendScans}
              />
            </label>

            {/* Ordered Multi-Document / Multi-Page Queue Organizer */}
            {scannedImages.length > 0 && (
              <div className="max-w-xl mx-auto text-left rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Arranged Page Order ({scannedImages.length} Page
                    {scannedImages.length > 1 ? "s" : ""})
                  </span>
                  <button
                    type="button"
                    onClick={() => setScannedImages([])}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Clear All
                  </button>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {scannedImages.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs shrink-0">
                          Page {idx + 1}
                        </span>
                        <div className="truncate">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {file.name}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveScanPage(idx, "up")}
                          disabled={idx === 0}
                          title="Move Page Up"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 transition"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveScanPage(idx, "down")}
                          disabled={idx === scannedImages.length - 1}
                          title="Move Page Down"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 transition"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeScanPage(idx)}
                          title="Remove Page"
                          className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition ml-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Centered Navigation Buttons */}
            <div className="flex items-center justify-center gap-4 pt-2 flex-wrap">
              <button
                onClick={() =>
                  setCurrentScreen(selectedTemplate ? "dashboard" : "upload_blank")
                }
                disabled={isExtracting}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>

              <button
                onClick={handleExtract}
                disabled={scannedImages.length === 0 || isExtracting}
                className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm shadow-md shadow-emerald-600/15 transition"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Aligning & Extracting {scannedImages.length} Page(s)...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Extract All {scannedImages.length || ""} Page(s)
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            SCREEN 5: VERIFY, STYLE & LIVE VISUAL COORDINATE NUDGING
        ========================================================= */}
        {currentScreen === "verify" && (
          <div className="rounded-3xl bg-white border border-slate-200 p-8 space-y-6 shadow-sm">
            <div className="text-center space-y-2 max-w-xl mx-auto">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                Step 3 of 4
              </span>
              <h2 className="text-2xl font-bold text-slate-900">
                Verify Text, Typography & Coordinates
              </h2>
              <p className="text-sm text-slate-600">
                Customize your ink color, font style, and text casing, or nudge any field
                on the live page preview.
              </p>
            </div>

            {/* Styling & Case Formatting Toolbar */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center gap-4 flex-wrap text-xs">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold text-slate-700">Ink:</span>
                <select
                  value={inkColor}
                  onChange={(e) => setInkColor(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 font-semibold text-slate-800"
                >
                  <option value="navy">Deep Navy Ink</option>
                  <option value="black">Pure Black</option>
                  <option value="blue">Ballpoint Blue</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold text-slate-700">Font:</span>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 font-semibold text-slate-800"
                >
                  <option value="helv">Helvetica (Clean Sans)</option>
                  <option value="tiro">Times Roman (Formal Serif)</option>
                  <option value="cour">Courier (Typewriter)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => formatAllFieldsCase("upper")}
                  className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 font-semibold text-slate-700 transition"
                >
                  ALL CAPS
                </button>
                <button
                  type="button"
                  onClick={() => formatAllFieldsCase("title")}
                  className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 font-semibold text-slate-700 transition"
                >
                  Title Case
                </button>
              </div>
            </div>

            {/* Multi-Page Switcher */}
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {Array.from({ length: pageCount }).map((_, pIdx) => (
                  <button
                    key={pIdx}
                    onClick={() => setActivePreviewPage(pIdx)}
                    className={`px-4 py-1.5 rounded-xl text-xs font-semibold border transition ${
                      activePreviewPage === pIdx
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    Page {pIdx + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Side-by-Side: Left = Editable Fields & Nudger | Right = Live Coordinate Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Left Column: Fields List */}
              <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                {fields.map((field, idx) => {
                  if (field.page_num !== activePreviewPage) return null;
                  const isSelected = selectedFieldIdx === idx;

                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedFieldIdx(idx)}
                      className={`p-4 rounded-2xl border transition cursor-pointer space-y-3 ${
                        isSelected
                          ? "bg-indigo-50/50 border-indigo-500 ring-2 ring-indigo-500/15"
                          : "bg-slate-50 border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800">
                          {field.field_label || `Field #${idx + 1}`}
                        </label>
                        <span
                          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold ${
                            field.field_type === "signature"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {field.field_type}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={field.handwritten_value}
                        disabled={field.field_type === "signature"}
                        onChange={(e) =>
                          updateField(idx, { handwritten_value: e.target.value })
                        }
                        className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-indigo-600"
                      />

                      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-xs text-slate-600">
                        <div className="flex items-center gap-1">
                          <Move className="w-3.5 h-3.5 text-indigo-600 mr-1" />
                          <button
                            type="button"
                            onClick={() =>
                              updateField(idx, { offset_x: field.offset_x - 4 })
                            }
                            className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 font-semibold"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateField(idx, { offset_x: field.offset_x + 4 })
                            }
                            className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 font-semibold"
                          >
                            →
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateField(idx, { offset_y: field.offset_y - 4 })
                            }
                            className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 font-semibold"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateField(idx, { offset_y: field.offset_y + 4 })
                            }
                            className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 font-semibold"
                          >
                            ↓
                          </button>
                        </div>

                        {field.field_type !== "signature" && (
                          <div className="flex items-center gap-1.5">
                            <span>Font:</span>
                            <input
                              type="number"
                              min={7}
                              max={22}
                              value={field.font_size}
                              onChange={(e) =>
                                updateField(idx, {
                                  font_size: Number(e.target.value) || 11,
                                })
                              }
                              className="w-14 px-2 py-1 rounded bg-white border border-slate-200 text-center font-semibold"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Live Visual Form Overlay Preview */}
              <div className="rounded-2xl border border-slate-200 bg-slate-100 p-3">
                <p className="text-[11px] font-semibold text-slate-500 text-center mb-2">
                  Live Coordinate Preview (Page {activePreviewPage + 1} of {pageCount})
                </p>
                {sessionId && (
                  <div className="relative w-full overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                    <img
                      src={`${API_URL}/api/session/${sessionId}/page/${activePreviewPage}/preview-image`}
                      alt="Blank Form Preview"
                      className="w-full h-auto block select-none"
                    />
                    {fields.map((f, idx) => {
                      if (f.page_num !== activePreviewPage) return null;
                      const [ymin, xmin, ymax, xmax] = f.box_2d;
                      const leftPct = (xmin + f.offset_x) / 10;
                      const topPct = (ymin + f.offset_y) / 10;
                      const widthPct = Math.max((xmax - xmin) / 10, 5);
                      const heightPct = Math.max((ymax - ymin) / 10, 2);

                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedFieldIdx(idx)}
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                          }}
                          className={`absolute flex items-center px-1 cursor-pointer transition ${
                            selectedFieldIdx === idx
                              ? "border-2 border-indigo-600 bg-indigo-500/15 z-10"
                              : "border border-emerald-500/70 bg-emerald-500/10"
                          }`}
                        >
                          <span className="text-[10px] font-bold text-indigo-950 truncate leading-none">
                            {f.handwritten_value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Centered Action Buttons */}
            <div className="flex items-center justify-center gap-4 pt-4 flex-wrap">
              <button
                onClick={() => setCurrentScreen("upload_scan")}
                disabled={isReconstructing}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Scan Arranger
              </button>

              <button
                onClick={handleReconstruct}
                disabled={isReconstructing}
                className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm shadow-md shadow-indigo-600/20 transition"
              >
                {isReconstructing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Building PDF, Word & Excel...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm & Generate Documents
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            SCREEN 6: DOWNLOAD (PDF / WORD / EXCEL) & NATIVE SHARE
        ========================================================= */}
        {currentScreen === "download" && pdfDownloadUrl && sessionId && (
          <div className="rounded-3xl bg-white border border-emerald-200 p-8 space-y-8 text-center shadow-sm">
            <div className="space-y-2 max-w-lg mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                Document Ready • {activeDocTitle}
              </span>
              <h2 className="text-2xl font-bold text-slate-900">
                Your Reconstructed Documents Are Ready!
              </h2>
              <p className="text-sm text-slate-600">
                Download your crisp vector PDF, editable Word document, or structured
                Excel sheet—or share directly to WhatsApp, Email, or other apps.
              </p>
            </div>

            {/* Centered Export & Share Buttons */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <a
                href={pdfDownloadUrl}
                download={`clean_${activeDocTitle}`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition"
              >
                <Download className="w-4 h-4" />
                Download PDF
              </a>

              <a
                href={`${API_URL}/api/export/${sessionId}/word`}
                download="reconstructed_form.docx"
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-600/15 transition"
              >
                <FileType2 className="w-4 h-4" />
                Export Word (.docx)
              </a>

              <a
                href={`${API_URL}/api/export/${sessionId}/excel`}
                download="reconstructed_form.xlsx"
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm shadow-md shadow-teal-600/15 transition"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Export Excel (.xlsx)
              </a>

              <button
                onClick={handleShareDocument}
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>

            {/* Centered Secondary Navigation Buttons */}
            <div className="flex items-center justify-center gap-4 flex-wrap">
              {fields.length > 0 && (
                <button
                  onClick={() => setCurrentScreen("verify")}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Edit Fields / Nudge Coordinates
                </button>
              )}

              <button
                onClick={() => setCurrentScreen("dashboard")}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
              >
                Return to Dashboard
              </button>
            </div>

            {/* Embedded PDF Preview */}
            <div className="pt-2">
              <iframe
                src={pdfDownloadUrl}
                className="w-full h-[550px] rounded-2xl border border-slate-200 bg-white shadow-inner"
                title="Reconstructed Clean PDF Preview"
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}