/* ============================================
   DETECTRA — Main Application Logic
   AI-Generated Image Detection
   ============================================ */

(function () {
  'use strict';

  // ─── Configuration ───
  const CONFIG = {
    maxFileSizeMB: 10,
    maxFileSizeBytes: 10 * 1024 * 1024,
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
    apiEndpoint: '/api/analyze',
    cooldownMs: 3000,
  };

  // ─── State ───
  let state = {
    isAnalyzing: false,
    lastAnalysisTime: 0,
    currentFile: null,
  };

  // ─── DOM Elements ───
  const $ = (sel) => document.querySelector(sel);
  const uploadZone = $('#upload-zone');
  const fileInput = $('#file-input');
  const preview = $('#preview');
  const previewImage = $('#preview-image');
  const previewFilename = $('#preview-filename');
  const previewSize = $('#preview-size');
  const scanLine = $('#scan-line');
  const analyzing = $('#analyzing');
  const result = $('#result');
  const resultVerdict = $('#result-verdict');
  const resultIcon = $('#result-icon');
  const resultLabel = $('#result-label');
  const resultConfidence = $('#result-confidence');
  const resultConfidenceFill = $('#result-confidence-fill');
  const resultAnalysis = $('#result-analysis');
  const errorMsg = $('#error-msg');
  const errorText = $('#error-text');
  const errorDetail = $('#error-detail');
  const toast = $('#toast');
  const btnNewScan = $('#btn-new-scan');
  const btnCopy = $('#btn-copy');
  const btnRetry = $('#btn-retry');

  // ─── Upload Zone Events ───
  uploadZone.addEventListener('click', () => {
    if (!state.isAnalyzing) fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('upload-zone--dragover');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('upload-zone--dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('upload-zone--dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  // Paste from clipboard
  document.addEventListener('paste', (e) => {
    if (state.isAnalyzing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        handleFile(item.getAsFile());
        break;
      }
    }
  });

  // ─── Buttons ───
  btnNewScan.addEventListener('click', resetToUpload);
  btnRetry.addEventListener('click', resetToUpload);
  btnCopy.addEventListener('click', copyResult);

  // ─── File Handler ───
  function handleFile(file) {
    // Validate file type
    if (!CONFIG.allowedTypes.includes(file.type)) {
      showToast('Unsupported file type. Use PNG, JPG, or WEBP.', 'error');
      return;
    }

    // Validate file size
    if (file.size > CONFIG.maxFileSizeBytes) {
      showToast(`File too large. Maximum size is ${CONFIG.maxFileSizeMB}MB.`, 'error');
      return;
    }

    // Cooldown check
    const now = Date.now();
    if (now - state.lastAnalysisTime < CONFIG.cooldownMs) {
      showToast('Please wait a moment before scanning again.', 'error');
      return;
    }

    state.currentFile = file;
    showPreview(file);
    analyzeImage(file);
  }

  // ─── Show Preview ───
  function showPreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImage.src = e.target.result;
      previewFilename.textContent = truncateFilename(file.name, 30);
      previewSize.textContent = formatFileSize(file.size);

      // Show preview, hide other states
      hideAll();
      preview.classList.add('preview--visible');
      uploadZone.classList.add('upload-zone--analyzing');
    };
    reader.readAsDataURL(file);
  }

  // ─── Analyze Image ───
  async function analyzeImage(file) {
    state.isAnalyzing = true;
    state.lastAnalysisTime = Date.now();

    // Show analyzing state
    analyzing.classList.add('analyzing--visible');
    scanLine.classList.add('preview__scan-line--active');

    try {
      // Compress and convert to base64 (keeps payload under Vercel's 4.5MB limit)
      const { base64, mimeType } = await compressAndEncode(file);

      // Call API
      const response = await fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          mimeType: mimeType,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${response.status})`);
      }

      const data = await response.json();
      showResult(data);
    } catch (err) {
      console.error('Analysis failed:', err);
      showError(
        'Analysis failed',
        err.message || 'Could not connect to the server. Please try again.'
      );
    } finally {
      state.isAnalyzing = false;
      analyzing.classList.remove('analyzing--visible');
      scanLine.classList.remove('preview__scan-line--active');
    }
  }

  // ─── Show Result ───
  function showResult(data) {
    const { verdict, confidence, analysis } = data;
    const confidencePercent = Math.round(confidence * 100);

    // Determine verdict class
    let verdictClass, icon, label;
    if (verdict === 'FAKE' || verdict === 'AI-GENERATED') {
      verdictClass = 'fake';
      icon = '🚨';
      label = 'AI-Generated';
    } else if (verdict === 'REAL' || verdict === 'AUTHENTIC') {
      verdictClass = 'real';
      icon = '✅';
      label = 'Authentic';
    } else {
      verdictClass = 'uncertain';
      icon = '🤔';
      label = 'Uncertain';
    }

    // Apply verdict styling
    resultVerdict.className = `result__verdict result__verdict--${verdictClass}`;
    resultIcon.textContent = icon;
    resultLabel.textContent = label;
    resultConfidence.textContent = `${confidencePercent}%`;
    resultAnalysis.textContent = analysis || 'No detailed analysis available.';

    // Animate confidence bar
    resultConfidenceFill.style.width = '0%';
    result.classList.add('result--visible');

    // Trigger confidence bar animation after DOM update
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resultConfidenceFill.style.width = `${confidencePercent}%`;
      });
    });
  }

  // ─── Show Error ───
  function showError(title, detail) {
    errorText.textContent = title;
    errorDetail.textContent = detail;
    errorMsg.classList.add('error-msg--visible');
  }

  // ─── Reset ───
  function resetToUpload() {
    hideAll();
    uploadZone.classList.remove('upload-zone--analyzing');
    fileInput.value = '';
    state.currentFile = null;
  }

  function hideAll() {
    preview.classList.remove('preview--visible');
    analyzing.classList.remove('analyzing--visible');
    result.classList.remove('result--visible');
    errorMsg.classList.remove('error-msg--visible');
    scanLine.classList.remove('preview__scan-line--active');
  }

  // ─── Copy Result ───
  function copyResult() {
    const label = resultLabel.textContent;
    const confidence = resultConfidence.textContent;
    const analysis = resultAnalysis.textContent;
    const text = `Detectra Analysis\n━━━━━━━━━━━━━━━━\nVerdict: ${label}\nConfidence: ${confidence}\n\n${analysis}\n\nScanned with Detectra`;

    navigator.clipboard.writeText(text).then(() => {
      showToast('Result copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  }

  // ─── Toast ───
  function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast toast--${type} toast--visible`;
    setTimeout(() => {
      toast.classList.remove('toast--visible');
    }, 3000);
  }

  // ─── Utilities ───

  // Compress image client-side to stay under Vercel's 4.5MB body limit
  // Resizes to max 1024px on longest side, converts to JPEG 0.85 quality
  function compressAndEncode(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const MAX_DIM = 1024;
        let { width, height } = img;

        // Scale down if needed
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round(height * (MAX_DIM / width));
            width = MAX_DIM;
          } else {
            width = Math.round(width * (MAX_DIM / height));
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to JPEG base64
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];

        resolve({ base64, mimeType: 'image/jpeg' });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for compression'));
      };

      img.src = url;
    });
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function truncateFilename(name, maxLen) {
    if (name.length <= maxLen) return name;
    const ext = name.split('.').pop();
    const base = name.slice(0, maxLen - ext.length - 4);
    return `${base}...${ext}`;
  }

})();
