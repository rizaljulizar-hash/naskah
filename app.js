/**
 * Video Timestamp & Transcriber - Application Controller
 * Clean, professional, mature UI without clutter or emojis.
 */

document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentRawFile = null;
    let currentFileData = null;
    let currentSequence = null;
    let currentVideoUrl = null;
    let transcriptSegments = [];
    let currentlyPlayingVideo = null;

    // Audio Transcriber Instance
    const transcriber = new AudioTranscriber();

    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const btnBrowse = document.getElementById('btn-browse');
    const btnImportHeader = document.getElementById('btn-import-header');
    
    const uploadSection = document.getElementById('upload-section');
    const workspaceSection = document.getElementById('workspace-section');

    // Header & Meta Elements
    const fileNameDisplay = document.getElementById('file-name-display');
    const fileMetaDisplay = document.getElementById('file-meta-display');
    const modelSelect = document.getElementById('model-select');
    const geminiApiKeyInput = document.getElementById('gemini-api-key');

    // Load saved Gemini API Key from localStorage
    const savedApiKey = localStorage.getItem('gemini_api_key') || '';
    if (geminiApiKeyInput) {
        geminiApiKeyInput.value = savedApiKey;
        transcriber.setGeminiApiKey(savedApiKey);
    }

    // Set default model engine
    if (modelSelect) {
        transcriber.setModel(modelSelect.value);
    }

    // Action Buttons
    const btnTranscribeAll = document.getElementById('btn-transcribe-all');
    const btnStopTranscribe = document.getElementById('btn-stop-transcribe');
    const statusBanner = document.getElementById('status-banner');
    const statusText = document.getElementById('status-text');
    const checkAllParts = document.getElementById('check-all-parts');

    // Table Body
    const partsTbody = document.getElementById('parts-tbody');

    // Export Buttons
    const btnExportTxt = document.getElementById('btn-export-txt');
    const btnExportMd = document.getElementById('btn-export-md');

    // Toast
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');

    // --- EVENT LISTENERS ---

    btnBrowse.addEventListener('click', () => fileInput.click());
    btnImportHeader.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    if (geminiApiKeyInput) {
        geminiApiKeyInput.addEventListener('input', (e) => {
            const key = e.target.value.trim();
            localStorage.setItem('gemini_api_key', key);
            transcriber.setGeminiApiKey(key);
        });
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', (e) => {
            const newModel = e.target.value;
            transcriber.setModel(newModel);
            const label = e.target.options[e.target.selectedIndex].text.split('(')[0].trim();
            showToast(`Model AI diganti ke ${label}`);
        });
    }

    // Select / Deselect All Checkbox
    if (checkAllParts) {
        checkAllParts.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            transcriptSegments.forEach(seg => seg.selected = isChecked);
            const checkboxes = partsTbody.querySelectorAll('.part-checkbox');
            checkboxes.forEach(cb => cb.checked = isChecked);
        });
    }

    // Stop Transcribe Button
    if (btnStopTranscribe) {
        btnStopTranscribe.addEventListener('click', () => {
            transcriber.stopProcessing();
            statusBanner.classList.add('hidden');
            btnTranscribeAll.disabled = false;
            btnTranscribeAll.classList.remove('btn-extracting');
            btnTranscribeAll.innerHTML = `<i data-lucide="sparkles"></i> Transkrip Part Terpilih`;
            lucide.createIcons();
            showToast("Transkrip dihentikan oleh pengguna. Teks yang sudah muncul tetap tersimpan.", "info");
        });
    }

    // Transcribe Selected Parts (Queue System)
    btnTranscribeAll.addEventListener('click', () => {
        if (!currentVideoUrl) {
            alert("URL video tidak ditemukan.");
            return;
        }

        const selectedCount = transcriptSegments.filter(s => s.selected !== false).length;
        if (selectedCount === 0) {
            alert("Silakan centang minimal satu part klip yang ingin ditranskrip.");
            return;
        }

        btnTranscribeAll.disabled = true;
        btnTranscribeAll.classList.add('btn-extracting');
        btnTranscribeAll.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Extracting (0/${selectedCount})...`;
        if (statusBanner) statusBanner.classList.remove('hidden');
        if (statusText) statusText.textContent = `Memulai queue transkrip AI (0/${selectedCount})...`;
        lucide.createIcons();

        transcriber.transcribeAllSegments(
            currentVideoUrl,
            transcriptSegments,
            (msg) => {
                btnTranscribeAll.innerHTML = `<i data-lucide="loader-2" class="spin"></i> ${msg}`;
                if (statusText) statusText.textContent = msg;
                lucide.createIcons();
            },
            (segIdx, updatedSeg) => {
                const row = partsTbody.children[segIdx];
                if (row) {
                    const txtArea = row.querySelector('.transcript-textarea');
                    if (txtArea) txtArea.value = updatedSeg.text;
                }
            },
            (segments, status) => {
                btnTranscribeAll.disabled = false;
                btnTranscribeAll.classList.remove('btn-extracting');
                btnTranscribeAll.innerHTML = `<i data-lucide="sparkles"></i> Transkrip Part Terpilih`;
                if (statusBanner) statusBanner.classList.add('hidden');
                lucide.createIcons();

                if (status === 'cancelled') {
                    showToast("Transkrip dihentikan. Teks yang sudah jadi tetap tersimpan.");
                } else if (status === 'no_selection') {
                    showToast("Tidak ada part terpilih untuk ditranskrip.", "info");
                } else {
                    showToast("Queue transkrip part terpilih selesai!");
                }
            }
        );
    });

    // Export .TXT Button
    btnExportTxt.addEventListener('click', () => {
        exportFile('txt');
    });

    // Export .MD Button
    btnExportMd.addEventListener('click', () => {
        exportFile('md');
    });

    // --- SCRIPT / STORYBOARD GUIDANCE HANDLING (.TXT, .DOCX, .PDF) ---

    const scriptFileInput = document.getElementById('script-file-input');
    const scriptStatusBadge = document.getElementById('script-status-badge');
    const scriptNameText = document.getElementById('script-name-text');
    const btnClearScript = document.getElementById('btn-clear-script');
    const btnPreviewScript = document.getElementById('btn-preview-script');

    const scriptModal = document.getElementById('script-modal');
    const scriptModalTextarea = document.getElementById('script-modal-textarea');
    const btnCloseScriptModal = document.getElementById('btn-close-script-modal');
    const btnCancelScriptModal = document.getElementById('btn-cancel-script-modal');
    const btnSaveScriptModal = document.getElementById('btn-save-script-modal');

    let currentScriptFileName = "";

    function extractOnlyDialogue(rawText) {
        if (!rawText) return "";

        // 1. Clean Production Header & Meta
        let text = rawText.replace(/Judul Produksi\s*:[\s\S]*?(?=SEGMENT|Shot|\d+\.|$)/gi, '');
        text = text.replace(/Director\s*:.*$/gm, '');
        text = text.replace(/Date\s*:.*$/gm, '');

        // 2. Scan lines for TALENT / VO / DIALOG spoken lines
        const lines = text.split(/[\r\n]+/);
        const dialogueLines = [];
        let isInsideDialogue = false;

        for (let line of lines) {
            let trimmed = line.trim();
            if (!trimmed) continue;

            // Strip visual direction noise on same line
            trimmed = trimmed
                .replace(/INT\.\s*STUDIO[-A-Z0-9]*/gi, '')
                .replace(/EXT\.\s*[-A-Z0-9]*/gi, '')
                .replace(/\bMS\.\s*TALENT\b/gi, '')
                .replace(/\bON\s*CAM\b/gi, '')
                .replace(/\bOFF\s*CAM\b/gi, '')
                .replace(/\bVO\s*ONLY\b/gi, '')
                .replace(/SEGMENT\s+[I|V|X]+/gi, '')
                .trim();

            if (!trimmed) continue;

            // Speaker label detection (TALENT :, VO :, AUDIO :, DIALOG :, NARRATOR :)
            const speakerMatch = trimmed.match(/^(TALENT|VO|AUDIO|NARRATOR|PRESENTER|DIALOG|DUBBING)\s*:\s*(.*)/i);
            if (speakerMatch) {
                isInsideDialogue = true;
                const content = speakerMatch[2].trim();
                if (content) dialogueLines.push(content);
                continue;
            }

            // Shot number marker e.g. "1." or "2."
            if (/^(\d+\.|\bShot\s*\d+)/i.test(trimmed)) {
                const remaining = trimmed.replace(/^(\d+\.|\bShot\s*\d+)/i, '').trim();
                if (remaining && !/^(INT\.|EXT\.|MS\.|ON CAM|Menampilkan|BAB|Part|Tujuan)/i.test(remaining)) {
                    dialogueLines.push(remaining);
                }
                continue;
            }

            // Ignore Visual description headers
            if (/^(Menampilkan|Tujuan Pembelajaran|BAB\s*["“]|Part\s*:)/i.test(trimmed)) {
                continue;
            }

            if (isInsideDialogue) {
                dialogueLines.push(trimmed);
            }
        }

        if (dialogueLines.length > 0) {
            return dialogueLines.join('\n\n');
        }

        // Fallback cleanup if speaker tags were missing
        return rawText
            .replace(/INT\.\s*STUDIO[-A-Z0-9]*/gi, '')
            .replace(/\bON\s*CAM\b/gi, '')
            .replace(/\bMS\.\s*TALENT\b/gi, '')
            .replace(/Menampilkan.*$/gm, '')
            .replace(/Tujuan Pembelajaran.*$/gm, '')
            .replace(/SEGMENT\s+[I|V|X]+/gi, '')
            .replace(/[\r\n]+/g, '\n')
            .trim();
    }

    // --- SMART STRUCTURAL STORYBOARD PARSER (SEGMENT + SHOT + COL 3 DIALOGUE) ---

    // --- UNIVERSAL MULTI-SUBJECT STORYBOARD PARSER ---

    async function parseStructuredStoryboard(pdfDoc) {
        const shotList = [];
        let currentSegment = null;
        let currentShotNumber = 1;
        let currentDialogueLines = [];

        let col1MaxX = 110;
        let col3MinX = 220;

        const flushCurrentShot = () => {
            if (currentSegment && currentDialogueLines.length > 0) {
                const dialogueText = currentDialogueLines.join(' ').replace(/\s+/g, ' ').trim();
                if (dialogueText.length > 0 && !/^(AUDIO|VISUAL|SHOT|NO\.|THUMBNAILS|PRODUCTION)$/i.test(dialogueText)) {
                    const segClean = currentSegment.replace(/SEGMENT\s+/i, 'SG ').trim();
                    shotList.push({
                        segment: currentSegment,
                        shot: currentShotNumber,
                        label: `${segClean} - SHT ${currentShotNumber}`,
                        dialogue: dialogueText
                    });
                }
                currentDialogueLines = [];
            }
        };

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Extract items with position
            const items = textContent.items.map(item => ({
                str: item.str.trim(),
                x: Math.round(item.transform[4]),
                y: Math.round(item.transform[5])
            })).filter(item => item.str.length > 0);

            // Sort top-to-bottom (Y descending), then left-to-right (X ascending)
            items.sort((a, b) => {
                if (Math.abs(a.y - b.y) > 4) {
                    return b.y - a.y;
                }
                return a.x - b.x;
            });

            // Group into visual lines
            const lines = [];
            let currentLine = [];
            let lastY = null;

            for (const item of items) {
                if (lastY === null || Math.abs(item.y - lastY) <= 4) {
                    currentLine.push(item);
                    lastY = item.y;
                } else {
                    if (currentLine.length > 0) lines.push(currentLine);
                    currentLine = [item];
                    lastY = item.y;
                }
            }
            if (currentLine.length > 0) lines.push(currentLine);

            for (const lineItems of lines) {
                const lineStr = lineItems.map(it => it.str).join(' ');

                // Adaptively set column bounds based on table header line if present
                const isHeaderLine = lineItems.some(it => /^(SHOT|VIDEO|AUDIO|THUMBNAILS)$/i.test(it.str));
                if (isHeaderLine) {
                    const videoItem = lineItems.find(it => /^(VIDEO|VISUAL|THUMBNAILS)$/i.test(it.str));
                    const audioItem = lineItems.find(it => /^(AUDIO|TALENT|DIRECTOR)$/i.test(it.str));

                    if (videoItem) col1MaxX = Math.max(70, videoItem.x - 10);
                    if (audioItem) col3MinX = Math.max(150, audioItem.x - 20);
                    continue;
                }

                // 1. Detect Segment Header across various styles (e.g. SEGMENT I, SEGMENT 2: OPENING, SEGMENT I(SHOOTING))
                const segMatch = lineStr.match(/\b(SEGMENT\s+[I|V|X\d]+[^\r\n]*)/i);
                if (segMatch) {
                    flushCurrentShot();
                    currentSegment = segMatch[1].toUpperCase();
                    currentShotNumber = 1;
                    continue;
                }

                // Auto-start SEGMENT I if first shot starts without explicit segment header
                if (!currentSegment) {
                    if (lineItems.some(it => it.x < col1MaxX && /^(\d+)[\.\s]?/.test(it.str))) {
                        currentSegment = "SEGMENT I";
                    } else {
                        continue;
                    }
                }

                // 2. Detect Shot Number in Column 1 (x < col1MaxX)
                const col1Item = lineItems.find(it => it.x < col1MaxX);
                if (col1Item) {
                    const shotMatch = col1Item.str.match(/^(\d+)[\.\s]?/);
                    if (shotMatch) {
                        const newShotNum = parseInt(shotMatch[1], 10);
                        if (newShotNum !== currentShotNumber && newShotNum < 60) {
                            flushCurrentShot();
                            currentShotNumber = newShotNum;
                        }
                    }
                }

                // 3. Extract Column 3 Spoken Dialogue (x >= col3MinX OR line contains TALENT / AUDIO / GURU / VO / DUBBING)
                const dialogueItems = lineItems.filter(it => {
                    if (/(TALENT|GURU|NARRATOR|PRESENTER|DUBBING)\s*:/i.test(it.str)) return true;
                    if (it.x >= col3MinX) {
                        if (/^(INT\.|EXT\.|MS\.|ON CAM|OFF CAM|VO |Menampilkan|Tujuan Pembelajaran|BAB|Part:)/i.test(it.str)) {
                            return false;
                        }
                        return true;
                    }
                    return false;
                });

                if (dialogueItems.length > 0) {
                    let lineDialogue = dialogueItems.map(it => it.str).join(' ')
                        .replace(/^(TALENT|GURU|NARRATOR|PRESENTER|DUBBING)\s*(\(.*?\))?\s*:\s*(ON-?CAM)?/gi, '')
                        .replace(/INT\.\s*STUDIO[-A-Z0-9]*/gi, '')
                        .replace(/\bON\s*CAM\b/gi, '')
                        .replace(/\bMS\.\s*TALENT\b/gi, '')
                        .trim();

                    if (lineDialogue.length > 0 && 
                        !/^(Judul Produksi|Director|Date|AUDIO|VISUAL|SHOT|NO\.|TALENT|Production|Thumbnails)$/i.test(lineDialogue)) {
                        currentDialogueLines.push(lineDialogue);
                    }
                }
            }
        }

        flushCurrentShot();
        return shotList;
    }

    let parsedStoryboardShots = null;

    if (scriptFileInput) {
        scriptFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast("Membaca & menganalisis struktur Storyboard...", "info");

            try {
                let rawText = "";
                parsedStoryboardShots = null;
                const ext = file.name.split('.').pop().toLowerCase();

                if (ext === 'txt') {
                    rawText = await file.text();
                } else if (ext === 'docx' || ext === 'doc') {
                    const arrayBuffer = await file.arrayBuffer();
                    if (window.mammoth) {
                        const res = await window.mammoth.extractRawText({ arrayBuffer });
                        rawText = res.value || "";
                    } else {
                        const dec = new TextDecoder('utf-8');
                        const rawStr = dec.decode(new Uint8Array(arrayBuffer));
                        rawText = rawStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
                    }
                } else if (ext === 'pdf') {
                    const arrayBuffer = await file.arrayBuffer();
                    if (window.pdfjsLib) {
                        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                        
                        // Parse PDF with exact Segment + Shot + Col 3 Dialogue structure!
                        parsedStoryboardShots = await parseStructuredStoryboard(pdf);

                        if (parsedStoryboardShots.length > 0) {
                            rawText = parsedStoryboardShots.map(s => `[${s.label}]\n${s.dialogue}`).join('\n\n');
                        } else {
                            const textChunks = [];
                            for (let i = 1; i <= pdf.numPages; i++) {
                                const page = await pdf.getPage(i);
                                const content = await page.getTextContent();
                                const pageText = content.items.map(item => item.str).join(' ');
                                textChunks.push(pageText);
                            }
                            rawText = textChunks.join('\n\n');
                        }
                    } else {
                        const dec = new TextDecoder('latin1');
                        const rawStr = dec.decode(new Uint8Array(arrayBuffer));
                        rawText = rawStr.replace(/[^\x20-\x7E\s]/g, ' ').replace(/\s+/g, ' ');
                    }
                }

                // Filter out Visual/Direction noise if raw text fallback used
                const cleanDialogue = parsedStoryboardShots ? rawText : extractOnlyDialogue(rawText.trim());

                if (cleanDialogue.length > 0) {
                    currentScriptFileName = file.name;
                    if (transcriber) {
                        transcriber.setReferenceScript(cleanDialogue);
                    }
                    const wordCount = cleanDialogue.split(/\s+/).length;
                    const shotCountMsg = parsedStoryboardShots ? ` • ${parsedStoryboardShots.length} Shot terdeteksi` : '';
                    scriptNameText.textContent = `${file.name} (${wordCount} kata${shotCountMsg})`;
                    scriptStatusBadge.classList.remove('hidden');

                    // Pre-fill transcript textboxes automatically with clean script dialogue & Shot labels!
                    applyScriptToTable(cleanDialogue, parsedStoryboardShots);

                    // Open Modal for review & quick edit
                    if (scriptModalTextarea) scriptModalTextarea.value = cleanDialogue;
                    if (scriptModal) scriptModal.classList.remove('hidden');

                    showToast(`Naskah "${file.name}" terdeteksi! ${parsedStoryboardShots ? parsedStoryboardShots.length : 0} Shot berhasil dipetakan.`);
                } else {
                    throw new Error("Teks dialog tidak terdeteksi di naskah.");
                }
            } catch (err) {
                console.error("Script parse error:", err);
                showToast(`Gagal membaca naskah: ${err.message}`, "warning");
            }
        });
    }

    if (btnPreviewScript) {
        btnPreviewScript.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (transcriber && transcriber.referenceScriptText && scriptModalTextarea) {
                scriptModalTextarea.value = transcriber.referenceScriptText;
            }
            if (scriptModal) scriptModal.classList.remove('hidden');
        });
    }

    const closeScriptModal = () => {
        if (scriptModal) scriptModal.classList.add('hidden');
    };

    if (btnCloseScriptModal) btnCloseScriptModal.addEventListener('click', closeScriptModal);
    if (btnCancelScriptModal) btnCancelScriptModal.addEventListener('click', closeScriptModal);

    function applyScriptToTable(cleanDialogue, parsedShots = null) {
        if (!transcriptSegments || transcriptSegments.length === 0) return;

        const shots = parsedShots || parsedStoryboardShots;

        if (shots && shots.length > 0) {
            transcriptSegments.forEach((seg, i) => {
                if (i < shots.length) {
                    const shotObj = shots[i];
                    seg.text = shotObj.dialogue;
                    seg.label = shotObj.label; // e.g. "SG III - SHT 1"
                }
            });
        } else {
            // Fallback sentence splitter
            const sentences = (cleanDialogue || '')
                .split(/[\r\n.!?]+/)
                .map(s => s.trim())
                .filter(s => s.length >= 3);

            transcriptSegments.forEach((seg, i) => {
                if (i < sentences.length) {
                    seg.text = sentences[i];
                    seg.label = `SG I - SHT ${i + 1}`;
                }
            });
        }

        renderTable();
    }

    if (btnSaveScriptModal) {
        btnSaveScriptModal.addEventListener('click', () => {
            const updatedText = scriptModalTextarea ? scriptModalTextarea.value.trim() : "";
            if (transcriber) {
                transcriber.setReferenceScript(updatedText);
            }
            const wordCount = updatedText ? updatedText.split(/\s+/).length : 0;
            if (scriptNameText && currentScriptFileName) {
                scriptNameText.textContent = `${currentScriptFileName} (${wordCount} kata dialog)`;
            }

            // Automatically populate transcript textboxes with clean script dialogue!
            applyScriptToTable(updatedText, parsedStoryboardShots);

            closeScriptModal();
            showToast("Naskah aktif & otomatis dimasukkan ke kotak transkrip!");
        });
    }

    if (btnClearScript) {
        btnClearScript.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (transcriber) {
                transcriber.setReferenceScript('');
            }
            if (scriptFileInput) scriptFileInput.value = '';
            scriptStatusBadge.classList.add('hidden');
            showToast("Naskah rujukan dihapus.");
        });
    }

    // --- CORE FILE HANDLING ---

    function handleFileSelect(file) {
        if (!file) return;
        currentRawFile = file;

        const fileName = file.name;

        (async () => {
            try {
                showToast("Membaca metadata video...", "info");

                const data = await VideoParser.parse(file);
                data.fileName = fileName;
                currentFileData = data;

                currentVideoUrl = data.videoUrl || URL.createObjectURL(file);

                if (currentFileData.sequences && currentFileData.sequences.length > 0) {
                    currentSequence = currentFileData.sequences[0];
                }

                initSegments();

                uploadSection.classList.add('hidden');
                workspaceSection.classList.remove('hidden');

                applyScriptToTable(transcriber ? transcriber.referenceScriptText : '', parsedStoryboardShots);
                showToast("File video berhasil di-import!");

            } catch (err) {
                console.error(err);
                alert(`Gagal membaca file video: ${err.message}`);
            }
        })();
    }

    function initSegments() {
        if (!currentFileData) return;

        let totalDur = 60;
        if (currentSequence) {
            totalDur = currentSequence.totalDuration;
        }

        const markers = currentSequence ? (currentSequence.markers || []) : [];
        transcriptSegments = transcriber.buildSegmentsFromMarkers(markers, totalDur);

        // Update Meta Display
        fileNameDisplay.textContent = currentFileData.fileName;
        const totalTimeStr = currentSequence ? currentSequence.formattedTotalDuration : VideoParser.formatTimecode(totalDur);
        fileMetaDisplay.textContent = `${totalTimeStr} • ${transcriptSegments.length} Klip Part`;
    }

    // --- TABLE RENDERER ---

    function renderTable() {
        partsTbody.innerHTML = '';

        if (transcriptSegments.length === 0) {
            partsTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Tidak ada klip ditemukan pada video ini.</td></tr>`;
            return;
        }

        transcriptSegments.forEach((seg, idx) => {
            if (seg.selected === undefined) seg.selected = (seg.category === 'Voice Over');

            const tr = document.createElement('tr');
            const midTime = seg.startTime + Math.max(0.5, (seg.endTime - seg.startTime) / 2);

            tr.innerHTML = `
                <!-- CHECKBOX PILIH PART -->
                <td style="text-align: center; vertical-align: middle;">
                    <input type="checkbox" class="part-checkbox" data-idx="${idx}" ${seg.selected ? 'checked' : ''} title="Centang untuk menyertakan klip ini dalam Queue Transkrip">
                </td>

                <!-- KOLOM 1: VIDEO PREVIEW (MIDPOINT THUMBNAIL) -->
                <td class="video-preview-cell">
                    <div class="video-preview-wrapper" data-start="${seg.startTime}" data-end="${seg.endTime}">
                        ${currentVideoUrl ? 
                            `<video class="mini-video-player" src="${currentVideoUrl}#t=${midTime.toFixed(2)}" preload="metadata" playsinline></video>` :
                            `<div class="mini-video-player" style="display:flex; align-items:center; justify-content:center; color:var(--text-dim); font-size:0.8rem;"><i data-lucide="file-video"></i> Video Part</div>`
                        }
                        <div class="mini-controls-bar">
                            <button class="btn-mini-control" title="Play/Pause">
                                <i data-lucide="play"></i>
                            </button>
                            <span class="mini-control-text">Play</span>
                        </div>
                    </div>
                </td>

                <!-- KOLOM 2: DURASI & KATEGORI -->
                <td>
                    <div class="duration-badge-box">
                        <span class="duration-primary">${seg.label || `Klip #${idx + 1}`}</span>
                        <span class="duration-secondary">${formatCleanTimecode(seg.startTime)} - ${formatCleanTimecode(seg.endTime)} (Durasi: ${formatDurationText(seg.endTime - seg.startTime)})</span>
                        <span class="badge ${seg.category === 'Voice Over' ? 'badge-vo' : 'badge-oncam'}" id="cat-badge-${idx}">
                            <i data-lucide="${seg.category === 'Voice Over' ? 'mic' : 'video'}"></i>
                            ${seg.category || 'On-Cam'}
                        </span>
                    </div>
                </td>

                <!-- KOLOM 3: TEXT TRANSKRIP -->
                <td>
                    <textarea class="transcript-textarea" placeholder="Hasil transkrip percakapan akan muncul di sini... (dapat diedit)" data-idx="${idx}">${escapeHtml(seg.text)}</textarea>
                </td>

                <!-- KOLOM 4: TOMBOL TRANSCRIBE AI (PER BARIS) -->
                <td style="text-align: center;">
                    <button class="btn btn-primary btn-sm btn-transcribe-row" data-idx="${idx}">
                        <i data-lucide="sparkles"></i> Transkrip AI
                    </button>
                </td>
            `;

            // Checkbox Event Listener
            const rowCheckbox = tr.querySelector('.part-checkbox');
            if (rowCheckbox) {
                rowCheckbox.addEventListener('change', (e) => {
                    seg.selected = e.target.checked;
                    const allChecked = transcriptSegments.every(s => s.selected !== false);
                    if (checkAllParts) checkAllParts.checked = allChecked;
                });
            }

            // Video Bottom Bar Control
            const videoEl = tr.querySelector('video.mini-video-player');
            const controlBar = tr.querySelector('.mini-controls-bar');
            const controlBtn = tr.querySelector('.btn-mini-control');
            const controlText = tr.querySelector('.mini-control-text');

            if (videoEl && currentVideoUrl) {
                const updateCategoryBadge = () => {
                    const category = transcriber.analyzeCanvasCategory(videoEl);
                    seg.category = category;

                    // By default: ONLY Voice Over (VO) segments are checked/selected!
                    const isVO = (category === 'Voice Over');
                    seg.selected = isVO;

                    const badgeEl = document.getElementById(`cat-badge-${idx}`);
                    if (badgeEl) {
                        badgeEl.className = `badge ${isVO ? 'badge-vo' : 'badge-oncam'}`;
                        badgeEl.innerHTML = `<i data-lucide="${isVO ? 'mic' : 'video'}"></i> ${category}`;
                        lucide.createIcons();
                    }

                    const rowCb = tr.querySelector('.part-checkbox');
                    if (rowCb) {
                        rowCb.checked = isVO;
                    }

                    // Update header check-all checkbox state
                    if (checkAllParts) {
                        const allChecked = transcriptSegments.every(s => s.selected === true);
                        checkAllParts.checked = allChecked;
                    }
                };

                videoEl.addEventListener('seeked', updateCategoryBadge, { once: true });

                videoEl.addEventListener('loadedmetadata', () => {
                    videoEl.currentTime = midTime;
                });

                const togglePlayPause = () => {
                    if (currentlyPlayingVideo && currentlyPlayingVideo !== videoEl) {
                        currentlyPlayingVideo.pause();
                    }

                    if (videoEl.paused) {
                        videoEl.currentTime = seg.startTime;
                        videoEl.muted = false;
                        videoEl.volume = 1.0;
                        videoEl.play();
                        currentlyPlayingVideo = videoEl;
                        
                        controlBtn.innerHTML = `<i data-lucide="pause"></i>`;
                        controlText.textContent = `Pause`;
                        controlBar.classList.add('playing');
                        lucide.createIcons();

                        const checkEndTime = () => {
                            if (videoEl.currentTime >= seg.endTime) {
                                videoEl.pause();
                                videoEl.currentTime = midTime;
                                videoEl.removeEventListener('timeupdate', checkEndTime);
                                controlBtn.innerHTML = `<i data-lucide="play"></i>`;
                                controlText.textContent = `Play`;
                                controlBar.classList.remove('playing');
                                lucide.createIcons();
                            }
                        };
                        videoEl.addEventListener('timeupdate', checkEndTime);
                    } else {
                        videoEl.pause();
                        videoEl.currentTime = midTime;
                        controlBtn.innerHTML = `<i data-lucide="play"></i>`;
                        controlText.textContent = `Play`;
                        controlBar.classList.remove('playing');
                        lucide.createIcons();
                    }
                };

                controlBar.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePlayPause();
                });

                videoEl.addEventListener('click', () => {
                    togglePlayPause();
                });
            }

            // Textarea Edit Sync
            const txtArea = tr.querySelector('.transcript-textarea');
            txtArea.addEventListener('input', (e) => {
                transcriptSegments[idx].text = e.target.value;
            });

            // Single Row Transcribe Action Button
            const btnTranscribeRow = tr.querySelector('.btn-transcribe-row');
            btnTranscribeRow.addEventListener('click', async () => {
                if (!currentVideoUrl) return;

                btnTranscribeRow.disabled = true;
                btnTranscribeRow.classList.add('btn-extracting');
                btnTranscribeRow.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Extracting...`;
                lucide.createIcons();

                const updatedSeg = await transcriber.transcribeSingleSegment(currentVideoUrl, seg, (msg) => {
                    btnTranscribeRow.innerHTML = `<i data-lucide="loader-2" class="spin"></i> ${msg}`;
                    lucide.createIcons();
                });

                txtArea.value = updatedSeg.text;

                btnTranscribeRow.disabled = false;
                btnTranscribeRow.classList.remove('btn-extracting');
                btnTranscribeRow.classList.add('btn-done');
                btnTranscribeRow.innerHTML = `<i data-lucide="check"></i> Selesai`;
                lucide.createIcons();

                setTimeout(() => {
                    btnTranscribeRow.classList.remove('btn-done');
                    btnTranscribeRow.innerHTML = `<i data-lucide="sparkles"></i> Transkrip AI`;
                    lucide.createIcons();
                }, 3000);

                if (updatedSeg.text && updatedSeg.text.startsWith('[ERROR')) {
                    showToast(`Klip #${idx + 1} error: ${updatedSeg.text}`);
                } else if (updatedSeg.text) {
                    showToast(`Klip #${idx + 1} berhasil di-transkrip!`);
                } else {
                    showToast(`Klip #${idx + 1} hening / tanpa percakapan.`);
                }
            });

            // Trigger background category detection (On-Cam vs Voice Over)
            if (!seg.category && currentVideoUrl) {
                transcriber.detectSegmentCategory(currentVideoUrl, seg.startTime, seg.endTime).then(category => {
                    seg.category = category;
                    const badgeEl = document.getElementById(`cat-badge-${idx}`);
                    if (badgeEl) {
                        badgeEl.className = `badge ${category === 'Voice Over' ? 'badge-vo' : 'badge-oncam'}`;
                        badgeEl.innerHTML = `<i data-lucide="${category === 'Voice Over' ? 'mic' : 'video'}"></i> ${category}`;
                        lucide.createIcons();
                    }
                });
            }

            partsTbody.appendChild(tr);
        });

        lucide.createIcons();
    }

    function formatCleanTimecode(seconds) {
        if (isNaN(seconds) || seconds < 0) return "00:00";
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const pad = (n) => String(n).padStart(2, '0');

        if (hrs > 0) {
            return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
        }
        return `${pad(mins)}:${pad(secs)}`;
    }

    function formatDurationText(seconds) {
        if (isNaN(seconds) || seconds <= 0) return "0d";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

        if (mins > 0) {
            return `${mins}m ${secs}d`;
        }
        return `${secs}d`;
    }

    // --- EXPORT HANDLING (.TXT & .MD) ---

    function exportFile(format) {
        if (!transcriptSegments || transcriptSegments.length === 0) {
            showToast("Belum ada data klip untuk di-ekspor.", "warning");
            return;
        }

        const videoName = currentFileData ? currentFileData.fileName.replace(/\.[^/.]+$/, "") : "Transkrip";
        let content = "";
        let fileName = "";
        let mimeType = "text/plain";

        if (format === 'txt') {
            fileName = `${videoName}_transkrip.txt`;
            content += `==========================================================\n`;
            content += `TRANSKRIP NASKAH & TIMECODE - ${videoName.toUpperCase()}\n`;
            content += `==========================================================\n\n`;

            transcriptSegments.forEach((seg, idx) => {
                const label = seg.label || `Klip #${idx + 1}`;
                const startStr = formatCleanTimecode(seg.startTime);
                const endStr = formatCleanTimecode(seg.endTime);
                const durStr = formatDurationText(seg.endTime - seg.startTime);
                const category = seg.category || 'On-Cam';
                const text = seg.text ? seg.text.trim() : '(Kosong)';

                content += `[${label}]\n`;
                content += `• Waktu   : ${startStr} - ${endStr} (Durasi: ${durStr})\n`;
                content += `• Tipe    : ${category}\n`;
                content += `• Dialog  : ${text}\n\n`;
                content += `----------------------------------------------------------\n\n`;
            });
        } else if (format === 'md') {
            fileName = `${videoName}_transkrip.md`;
            content += `# 🎬 Transkrip Storyboard - ${videoName}\n\n`;
            content += `> **Total Klip**: ${transcriptSegments.length} Klip\n\n`;

            transcriptSegments.forEach((seg, idx) => {
                const label = seg.label || `Klip #${idx + 1}`;
                const startStr = formatCleanTimecode(seg.startTime);
                const endStr = formatCleanTimecode(seg.endTime);
                const durStr = formatDurationText(seg.endTime - seg.startTime);
                const category = seg.category || 'On-Cam';
                const text = seg.text ? seg.text.trim() : '(Kosong)';

                content += `### 📌 ${label}\n`;
                content += `- **Waktu**: \`${startStr} - ${endStr}\` *(Durasi: ${durStr})*\n`;
                content += `- **Kategori**: \`${category}\` \n`;
                content += `- **Dialog**:\n  > "${text}"\n\n`;
            });
        }

        const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Transkrip berhasil diekspor (${fileName})!`);
    }

    function showToast(msg) {
        toastMsg.textContent = msg;
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }
    window.showToast = showToast;

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
});
