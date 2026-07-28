/**
 * Video Timestamp & Transcriber - Application Controller
 * Clean, professional, minimal UI layout.
 */

document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentRawFile = null;
    let currentFileData = null;
    let currentSequence = null;
    let currentVideoUrl = null;
    let transcriptSegments = [];
    let currentlyPlayingVideo = null;
    let currentScriptFileName = "";

    // Audio Transcriber Instance
    const transcriber = new AudioTranscriber();

    // DOM Elements - Topbar & Inputs
    const fileInput = document.getElementById('file-input');
    const scriptFileInput = document.getElementById('script-file-input');

    const btnImportHeader = document.getElementById('btn-import-header');
    const btnImportScript = document.getElementById('btn-import-script');
    const btnEmptyImportVideo = document.getElementById('btn-empty-import-video');
    const btnEmptyImportScript = document.getElementById('btn-empty-import-script');

    const fileNameDisplay = document.getElementById('file-name-display');
    const fileMetaDisplay = document.getElementById('file-meta-display');
    const labelImportVideo = document.getElementById('label-import-video');
    const labelImportScript = document.getElementById('label-import-script');

    // Settings Modal
    const btnOpenSettings = document.getElementById('btn-open-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const settingsModal = document.getElementById('settings-modal');
    const modelSelect = document.getElementById('model-select');
    const geminiApiKeyInput = document.getElementById('gemini-api-key');

    // Load saved Gemini API Key
    const savedApiKey = localStorage.getItem('gemini_api_key') || '';
    if (geminiApiKeyInput) {
        geminiApiKeyInput.value = savedApiKey;
        transcriber.setGeminiApiKey(savedApiKey);
    }
    if (modelSelect) {
        transcriber.setModel(modelSelect.value);
    }

    // Loading & Banner Overlays
    const videoLoadingOverlay = document.getElementById('video-loading-overlay');
    const statusBanner = document.getElementById('status-banner');
    const statusText = document.getElementById('status-text');
    const btnStopTranscribe = document.getElementById('btn-stop-transcribe');

    // Table & Empty State Elements
    const partsTbody = document.getElementById('parts-tbody');
    const emptyTableState = document.getElementById('empty-table-state');
    const toggleManualMode = document.getElementById('toggle-manual-mode');
    const checkAllParts = document.getElementById('check-all-parts');
    const btnTranscribeAll = document.getElementById('btn-transcribe-all');

    // Script Modal
    const scriptModal = document.getElementById('script-modal');
    const scriptModalTextarea = document.getElementById('script-modal-textarea');
    const btnCloseScriptModal = document.getElementById('btn-close-script-modal');
    const btnCancelScriptModal = document.getElementById('btn-cancel-script-modal');
    const btnSaveScriptModal = document.getElementById('btn-save-script-modal');

    // Export Buttons
    const btnExportTxt = document.getElementById('btn-export-txt');
    const btnExportMd = document.getElementById('btn-export-md');

    // Toast
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');

    // --- EVENT LISTENERS ---

    if (btnImportHeader) btnImportHeader.addEventListener('click', () => fileInput.click());
    if (btnEmptyImportVideo) btnEmptyImportVideo.addEventListener('click', () => fileInput.click());
    if (btnImportScript) btnImportScript.addEventListener('click', () => scriptFileInput.click());
    if (btnEmptyImportScript) btnEmptyImportScript.addEventListener('click', () => scriptFileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    // Settings Modal Open / Close
    if (btnOpenSettings) {
        btnOpenSettings.addEventListener('click', () => {
            if (settingsModal) settingsModal.classList.remove('hidden');
        });
    }

    if (btnCloseSettings) {
        btnCloseSettings.addEventListener('click', () => {
            if (settingsModal) settingsModal.classList.add('hidden');
        });
    }

    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', () => {
            if (geminiApiKeyInput) {
                const key = geminiApiKeyInput.value.trim();
                localStorage.setItem('gemini_api_key', key);
                transcriber.setGeminiApiKey(key);
            }
            if (modelSelect) {
                transcriber.setModel(modelSelect.value);
            }
            if (settingsModal) settingsModal.classList.add('hidden');
            showToast("Pengaturan AI berhasil disimpan!", "success");
        });
    }

    // Toggle Manual Mode (Checkbox & Batch Button Visibility)
    if (toggleManualMode) {
        toggleManualMode.addEventListener('change', (e) => {
            const isManual = e.target.checked;
            document.querySelectorAll('.col-checkbox').forEach(el => {
                if (isManual) el.classList.remove('hidden');
                else el.classList.add('hidden');
            });
            if (btnTranscribeAll) {
                if (isManual) btnTranscribeAll.classList.remove('hidden');
                else btnTranscribeAll.classList.add('hidden');
            }
        });
    }

    if (btnExportTxt) btnExportTxt.addEventListener('click', () => exportFile('txt'));
    if (btnExportMd) btnExportMd.addEventListener('click', () => exportFile('md'));

    // --- UNIVERSAL STORYBOARD PARSERS ---

    function parseMarkdownStoryboard(mdText) {
        const shotList = [];
        let currentSegment = "SEGMENT I";
        let currentShotNumber = 1;

        const lines = mdText.split(/\r?\n/);

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            const segMatch = line.match(/\b(SEGMENT\s+[I|V|X\d]+[^\r\n]*)/i);
            if (segMatch) {
                currentSegment = segMatch[1].replace(/\|/g, '').trim().toUpperCase();
                currentShotNumber = 1;
            }

            if (line.startsWith('|')) {
                const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                if (cells.length >= 2) {
                    const col1 = cells[0] || '';
                    const col2 = cells[1] || '';
                    const col3 = cells[2] || '';

                    if (/^(SHOT|NO\.?)$/i.test(col1) || /^[-:\s]+$/.test(col1)) {
                        continue;
                    }

                    const segInCol1 = col1.match(/\b(SEGMENT\s+[I|V|X\d]+[^\r\n]*)/i);
                    if (segInCol1) {
                        currentSegment = segInCol1[1].toUpperCase();
                        currentShotNumber = 1;
                        continue;
                    }

                    const shotMatch = col1.match(/^(\d+)[\.\s]?/);
                    if (shotMatch) {
                        currentShotNumber = parseInt(shotMatch[1], 10);
                    }

                    let rawDialogue = col3 || (/(TALENT|GURU|AUDIO|VO|DIALOG)\s*:/i.test(col2) ? col2 : '');
                    if (rawDialogue) {
                        let dialogue = rawDialogue
                            .replace(/!\[\]\[image\d+\]/gi, '')
                            .replace(/[\*\_\#\\!]/g, '')
                            .replace(/^(TALENT|GURU|NARRATOR|PRESENTER|DUBBING)\s*(\(.*?\))?\s*:\s*(ON-?CAM)?/gi, '')
                            .replace(/INT\.\s*STUDIO[-A-Z0-9]*/gi, '')
                            .replace(/\bON\s*CAM\b/gi, '')
                            .replace(/\bMS\.\s*TALENT\b/gi, '')
                            .replace(/\s+/g, ' ')
                            .trim();

                        if (dialogue.length > 0) {
                            const segClean = currentSegment.replace(/SEGMENT\s+/i, 'SG ').trim();
                            shotList.push({
                                segment: currentSegment,
                                shot: currentShotNumber,
                                label: `${segClean} - SHT ${currentShotNumber}`,
                                dialogue: dialogue
                            });
                        }
                    }
                }
            }
        }

        return shotList;
    }

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

            const items = textContent.items.map(item => ({
                str: item.str.trim(),
                x: Math.round(item.transform[4]),
                y: Math.round(item.transform[5])
            })).filter(item => item.str.length > 0);

            items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

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

                const isHeaderLine = lineItems.some(it => /^(SHOT|VIDEO|AUDIO|THUMBNAILS)$/i.test(it.str));
                if (isHeaderLine) {
                    const videoItem = lineItems.find(it => /^(VIDEO|VISUAL|THUMBNAILS)$/i.test(it.str));
                    const audioItem = lineItems.find(it => /^(AUDIO|TALENT|DIRECTOR)$/i.test(it.str));

                    if (videoItem) col1MaxX = Math.max(70, videoItem.x - 10);
                    if (audioItem) col3MinX = Math.max(150, audioItem.x - 20);
                    continue;
                }

                const segMatch = lineStr.match(/\b(SEGMENT\s+[I|V|X\d]+[^\r\n]*)/i);
                if (segMatch) {
                    flushCurrentShot();
                    currentSegment = segMatch[1].toUpperCase();
                    currentShotNumber = 1;
                    continue;
                }

                if (!currentSegment) {
                    if (lineItems.some(it => it.x < col1MaxX && /^(\d+)[\.\s]?/.test(it.str))) {
                        currentSegment = "SEGMENT I";
                    } else {
                        continue;
                    }
                }

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

    async function handleScriptFile(file) {
        if (!file) return;

        showToast("Membaca & menganalisis Naskah...", "info");

        try {
            let rawText = "";
            parsedStoryboardShots = null;
            const ext = file.name.split('.').pop().toLowerCase();

            if (ext === 'md' || ext === 'markdown') {
                rawText = await file.text();
                parsedStoryboardShots = parseMarkdownStoryboard(rawText);
                if (parsedStoryboardShots.length > 0) {
                    rawText = parsedStoryboardShots.map(s => `[${s.label}]\n${s.dialogue}`).join('\n\n');
                }
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
            } else {
                rawText = await file.text();
                parsedStoryboardShots = parseMarkdownStoryboard(rawText);
                if (parsedStoryboardShots.length > 0) {
                    rawText = parsedStoryboardShots.map(s => `[${s.label}]\n${s.dialogue}`).join('\n\n');
                }
            }

            const cleanDialogue = parsedStoryboardShots ? rawText : extractOnlyDialogue(rawText.trim());

            if (cleanDialogue.length > 0) {
                currentScriptFileName = file.name;
                if (transcriber) {
                    transcriber.setReferenceScript(cleanDialogue);
                }
                if (labelImportScript) labelImportScript.textContent = `Ganti Naskah`;

                if (parsedStoryboardShots && parsedStoryboardShots.length > 0) {
                    applyScriptToTable(parsedStoryboardShots);
                }

                showToast(`Naskah "${file.name}" aktif!`, "success");
            } else {
                showToast("File naskah tidak berisi teks dialog yang valid.", "warning");
            }
        } catch (err) {
            console.error("Gagal membaca file naskah:", err);
            showToast("Gagal membaca file naskah.", "error");
        }
    }

    if (scriptFileInput) {
        scriptFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            await handleScriptFile(file);
        });
    }

    function extractOnlyDialogue(rawText) {
        if (!rawText) return "";
        let text = rawText.replace(/Judul Produksi\s*:[\s\S]*?(?=SEGMENT|Shot|\d+\.|$)/gi, '');
        text = text.replace(/Director\s*:.*$/gm, '');
        text = text.replace(/Date\s*:.*$/gm, '');

        const lines = text.split(/[\r\n]+/);
        const dialogueLines = [];
        let isInsideDialogue = false;

        for (let line of lines) {
            let trimmed = line.trim();
            if (!trimmed) continue;

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

            const speakerMatch = trimmed.match(/^(TALENT|VO|AUDIO|NARRATOR|PRESENTER|DIALOG|DUBBING)\s*:\s*(.*)/i);
            if (speakerMatch) {
                isInsideDialogue = true;
                const content = speakerMatch[2].trim();
                if (content) dialogueLines.push(content);
                continue;
            }

            if (/^(\d+\.|\bShot\s*\d+)/i.test(trimmed)) {
                const remaining = trimmed.replace(/^(\d+\.|\bShot\s*\d+)/i, '').trim();
                if (remaining && !/^(INT\.|EXT\.|MS\.|ON CAM|Menampilkan|BAB|Part|Tujuan)/i.test(remaining)) {
                    dialogueLines.push(remaining);
                }
                continue;
            }

            if (/^(Menampilkan|Tujuan Pembelajaran|BAB\s*["“]|Part\s*:)/i.test(trimmed)) {
                continue;
            }

            if (isInsideDialogue) {
                dialogueLines.push(trimmed);
            }
        }

        if (dialogueLines.length > 0) return dialogueLines.join('\n\n');

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

    function applyScriptToTable(scriptTextOrShots) {
        if (!transcriptSegments || transcriptSegments.length === 0) return;

        let shotList = [];

        if (Array.isArray(scriptTextOrShots) && scriptTextOrShots.length > 0) {
            shotList = scriptTextOrShots;
        } else if (typeof scriptTextOrShots === 'string' && scriptTextOrShots.trim().length > 0) {
            const paragraphs = scriptTextOrShots.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
            paragraphs.forEach((p, idx) => {
                shotList.push({
                    label: `Klip #${idx + 1}`,
                    dialogue: p
                });
            });
        }

        if (shotList.length > 0) {
            transcriptSegments.forEach((seg, idx) => {
                if (idx < shotList.length) {
                    seg.text = shotList[idx].dialogue;
                    if (shotList[idx].label) {
                        seg.label = shotList[idx].label;
                    }
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
            applyScriptToTable(updatedText);
            if (scriptModal) scriptModal.classList.add('hidden');
            showToast("Naskah aktif & otomatis dimasukkan ke tabel!");
        });
    }

    if (btnCloseScriptModal) btnCloseScriptModal.addEventListener('click', () => scriptModal.classList.add('hidden'));
    if (btnCancelScriptModal) btnCancelScriptModal.addEventListener('click', () => scriptModal.classList.add('hidden'));

    // --- CORE VIDEO FILE HANDLING WITH IMMEDIATE TABLE RENDER ---

    function handleFileSelect(file) {
        if (!file) return;
        currentRawFile = file;

        // Show Video Processing Overlay
        if (videoLoadingOverlay) videoLoadingOverlay.classList.remove('hidden');

        (async () => {
            try {
                showToast("Memotong & memproses klip video...", "info");

                const data = await VideoParser.parse(file);
                data.fileName = file.name;
                currentFileData = data;

                currentVideoUrl = data.videoUrl || URL.createObjectURL(file);

                if (currentFileData.sequences && currentFileData.sequences.length > 0) {
                    currentSequence = currentFileData.sequences[0];
                }

                initSegments();

                if (parsedStoryboardShots && parsedStoryboardShots.length > 0) {
                    applyScriptToTable(parsedStoryboardShots);
                } else {
                    // IMMEDIATELY RENDER TABLE EVEN WITHOUT SCRIPT!
                    renderTable();
                }

                if (emptyTableState) emptyTableState.classList.add('hidden');
                showToast("Video berhasil diproses & terpotong!", "success");

            } catch (err) {
                console.error(err);
                showToast(`Gagal membaca video: ${err.message}`, "error");
            } finally {
                // Hide Video Processing Overlay
                if (videoLoadingOverlay) videoLoadingOverlay.classList.add('hidden');
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

        // Update Topbar Meta Display
        if (fileNameDisplay) fileNameDisplay.textContent = currentFileData.fileName;
        if (labelImportVideo) labelImportVideo.textContent = "Ganti Video";
        const totalTimeStr = currentSequence ? currentSequence.formattedTotalDuration : VideoParser.formatTimecode(totalDur);
        if (fileMetaDisplay) fileMetaDisplay.textContent = `${totalTimeStr} • ${transcriptSegments.length} Klip Part`;
    }

    // --- TABLE RENDERER ---

    function renderTable() {
        if (!partsTbody) return;
        partsTbody.innerHTML = '';

        if (transcriptSegments.length === 0) {
            if (emptyTableState) emptyTableState.classList.remove('hidden');
            return;
        }

        if (emptyTableState) emptyTableState.classList.add('hidden');

        const isManualChecked = toggleManualMode ? toggleManualMode.checked : false;

        transcriptSegments.forEach((seg, idx) => {
            if (seg.selected === undefined) seg.selected = (seg.category === 'Voice Over');

            const tr = document.createElement('tr');
            const midTime = seg.startTime + Math.max(0.5, (seg.endTime - seg.startTime) / 2);

            tr.innerHTML = `
                <!-- CHECKBOX PILIH PART (MANUAL MODE) -->
                <td width="36" class="col-checkbox ${isManualChecked ? '' : 'hidden'}" style="text-align: center; vertical-align: middle;">
                    <input type="checkbox" class="part-checkbox" data-idx="${idx}" ${seg.selected ? 'checked' : ''}>
                </td>

                <!-- KOLOM 1: VIDEO PREVIEW WITH CLEAN PLAY ICON & TINY SYMBOL OVERLAY -->
                <td class="video-preview-cell">
                    <div class="video-preview-wrapper" data-start="${seg.startTime}" data-end="${seg.endTime}">
                        ${currentVideoUrl ? 
                            `<video class="mini-video-player" src="${currentVideoUrl}#t=${midTime.toFixed(2)}" preload="metadata" playsinline></video>` :
                            `<div class="mini-video-player" style="display:flex; align-items:center; justify-content:center; color:var(--text-dim); font-size:0.8rem;"><i data-lucide="file-video"></i> Video Part</div>`
                        }
                        <!-- CLEAN PLAY ICON IN CENTER (NO CIRCLE BG) -->
                        <button class="play-overlay-btn" title="Play/Pause">
                            <i data-lucide="play"></i>
                        </button>
                        <!-- TINY SYMBOL OVERLAY (MIC FOR VO, CAMERA FOR ON-CAM) AT BOTTOM-LEFT -->
                        <div class="symbol-overlay ${seg.category === 'Voice Over' ? 'symbol-vo' : 'symbol-oncam'}" id="cat-badge-${idx}" title="${seg.category || 'Voice Over'}">
                            <i data-lucide="${seg.category === 'Voice Over' ? 'mic' : 'video'}"></i>
                        </div>
                    </div>
                </td>

                <!-- KOLOM 2: SEGMEN & SHOT + DURASI -->
                <td>
                    <div class="shot-cell-box">
                        <div class="shot-title">${seg.label || `Klip #${idx + 1}`}</div>
                        <div class="duration-badge">
                            <i data-lucide="clock"></i> ${formatCleanTimecode(seg.endTime - seg.startTime)}
                        </div>
                        <div class="timecode-sub">${formatCleanTimecode(seg.startTime)} ➔ ${formatCleanTimecode(seg.endTime)}</div>
                    </div>
                </td>

                <!-- KOLOM 3: TEKS DIALOG (AUTO-RESIZE TEXTAREA - NO SCROLLBAR) -->
                <td>
                    <textarea class="transcript-textarea" placeholder="Belum ada dialog naskah rujukan..." data-idx="${idx}">${escapeHtml(seg.text)}</textarea>
                </td>
            `;

            // Textarea Auto-Resize Handler (No inner scrollbar!)
            const txtArea = tr.querySelector('.transcript-textarea');
            const autoResize = () => {
                txtArea.style.height = 'auto';
                txtArea.style.height = (txtArea.scrollHeight) + 'px';
            };

            txtArea.addEventListener('input', (e) => {
                transcriptSegments[idx].text = e.target.value;
                autoResize();
            });

            // Adjust height after DOM insertion
            setTimeout(autoResize, 0);

            // Video Play / Pause Logic with Clean Play Icon
            const videoEl = tr.querySelector('video.mini-video-player');
            const playOverlayBtn = tr.querySelector('.play-overlay-btn');

            if (videoEl && currentVideoUrl && playOverlayBtn) {
                videoEl.addEventListener('loadedmetadata', () => {
                    videoEl.currentTime = midTime;
                });

                videoEl.addEventListener('seeked', () => {
                    const category = transcriber.analyzeCanvasCategory(videoEl);
                    seg.category = category;
                    const badgeEl = document.getElementById(`cat-badge-${idx}`);
                    if (badgeEl) {
                        badgeEl.className = `symbol-overlay ${category === 'Voice Over' ? 'symbol-vo' : 'symbol-oncam'}`;
                        badgeEl.title = category;
                        badgeEl.innerHTML = `<i data-lucide="${category === 'Voice Over' ? 'mic' : 'video'}"></i>`;
                        lucide.createIcons();
                    }
                }, { once: true });

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
                        
                        playOverlayBtn.innerHTML = `<i data-lucide="pause"></i>`;
                        playOverlayBtn.classList.add('playing');
                        lucide.createIcons();

                        const checkEndTime = () => {
                            if (videoEl.currentTime >= seg.endTime) {
                                videoEl.pause();
                                videoEl.currentTime = midTime;
                                videoEl.removeEventListener('timeupdate', checkEndTime);
                                playOverlayBtn.innerHTML = `<i data-lucide="play"></i>`;
                                playOverlayBtn.classList.remove('playing');
                                lucide.createIcons();
                            }
                        };
                        videoEl.addEventListener('timeupdate', checkEndTime);
                    } else {
                        videoEl.pause();
                        videoEl.currentTime = midTime;
                        playOverlayBtn.innerHTML = `<i data-lucide="play"></i>`;
                        playOverlayBtn.classList.remove('playing');
                        lucide.createIcons();
                    }
                };

                playOverlayBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePlayPause();
                });

                videoEl.addEventListener('click', () => {
                    togglePlayPause();
                });
            }

            // Detect segment category (VO vs On-Cam) dynamically
            if (!seg.category && currentVideoUrl) {
                transcriber.detectSegmentCategory(currentVideoUrl, seg.startTime, seg.endTime).then(category => {
                    seg.category = category;
                    const badgeEl = document.getElementById(`cat-badge-${idx}`);
                    if (badgeEl) {
                        badgeEl.className = `symbol-overlay ${category === 'Voice Over' ? 'symbol-vo' : 'symbol-oncam'}`;
                        badgeEl.title = category;
                        badgeEl.innerHTML = `<i data-lucide="${category === 'Voice Over' ? 'mic' : 'video'}"></i>`;
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

        if (format === 'txt') {
            fileName = `${videoName}_transkrip.txt`;
            content += `==========================================================\n`;
            content += `TRANSKRIP NASKAH & TIMECODE - ${videoName.toUpperCase()}\n`;
            content += `==========================================================\n\n`;

            transcriptSegments.forEach((seg, idx) => {
                const label = seg.label || `Klip #${idx + 1}`;
                const startStr = formatCleanTimecode(seg.startTime);
                const endStr = formatCleanTimecode(seg.endTime);
                const durStr = formatCleanTimecode(seg.endTime - seg.startTime);
                const text = seg.text ? seg.text.trim() : '(Kosong)';

                content += `[${label}]\n`;
                content += `• Waktu   : ${startStr} - ${endStr} (Durasi: ${durStr})\n`;
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
                const durStr = formatCleanTimecode(seg.endTime - seg.startTime);
                const text = seg.text ? seg.text.trim() : '(Kosong)';

                content += `### 📌 ${label}\n`;
                content += `- **Waktu**: \`${startStr} - ${endStr}\` *(Durasi: ${durStr})*\n`;
                content += `- **Dialog**:\n  > "${text}"\n\n`;
            });
        }

        const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Transkrip berhasil diekspor (${fileName})!`, "success");
    }

    function showToast(msg) {
        if (!toastMsg || !toast) return;
        toastMsg.textContent = msg;
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
});
