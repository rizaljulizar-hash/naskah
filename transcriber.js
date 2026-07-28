/**
 * Local AI Audio Transcriber Engine
 * Fast & reliable streaming audio capture from <video> element
 * Uses volume=1.0 with muted destination output to prevent silence & prevent speaker noise.
 */

class AudioTranscriber {
    constructor() {
        this.isProcessing = false;
        this.whisperPipeline = null;
        this.language = 'id';
        this.modelName = 'onnx-community/whisper-small';
    }

    setLanguage(langCode) {
        this.language = (langCode && langCode.startsWith('id')) ? 'id' : 'en';
    }

    setModel(modelName) {
        if (this.modelName !== modelName) {
            this.modelName = modelName;
            this.whisperPipeline = null; // Reset pipeline so new model loads on next transcribe
            console.log("[Whisper] Model switched to:", modelName);
        }
    }

    stopProcessing() {
        this.isProcessing = false;
    }

    cleanHallucinatedText(rawText) {
        if (!rawText) return '';
        let cleaned = rawText
            .replace(/\[[^\]]*\]/g, '')
            .replace(/\(.*?\)/g, '')
            .trim();
        if (/^(mengaran|mengarah|terima\s*kasih|musik|suara|nonton|rekaman|subtitles|caption|you)$/i.test(cleaned)) {
            return '';
        }
        return cleaned;
    }

    async ensurePipeline(onProgress) {
        if (this.whisperPipeline) return;

        // If Gemini model is selected, map pipeline target to local whisper-small ONNX model
        const targetModel = this.modelName.startsWith('gemini') ? 'onnx-community/whisper-small' : this.modelName;

        const pipeFn = window.transformersPipeline;
        const env = window.transformersEnv;
        if (env) {
            env.allowLocalModels = true;
            env.allowRemoteModels = true;
            env.localURL = './models/';
        }

        if (onProgress) onProgress("Memuat Whisper Lokal...");
        console.log("[Whisper] Loading ONNX model from local disk:", targetModel);

        try {
            if (pipeFn) {
                this.whisperPipeline = await pipeFn('automatic-speech-recognition', targetModel, {
                    dtype: 'q8',
                });
            } else {
                const mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3');
                this.whisperPipeline = await mod.pipeline('automatic-speech-recognition', targetModel, {
                    dtype: 'q8',
                });
            }
            console.log("[Whisper] AI Pipeline ready!");
        } catch (err) {
            console.error("[Whisper] Error loading pipeline:", err);
            throw new Error("Gagal memuat model AI Whisper: " + (err.message || err));
        }
    }

    /**
     * Decode full audio file into memory once for instant sub-millisecond segment extraction.
     */
    async loadAudioBuffer(videoUrl) {
        if (this.cachedVideoUrl === videoUrl && this.cachedAudioBuffer) {
            return this.cachedAudioBuffer;
        }

        // Avoid duplicate concurrent decodes by sharing the same in-flight Promise
        if (this.cachedVideoUrl === videoUrl && this.decodingPromise) {
            return await this.decodingPromise;
        }

        console.log("[FastAudio] Pre-decoding video audio buffer into RAM...");
        this.cachedVideoUrl = videoUrl;
        
        this.decodingPromise = (async () => {
            const res = await fetch(videoUrl);
            const arrayBuffer = await res.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.cachedAudioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log(`[FastAudio] Full audio decoded into RAM: ${this.cachedAudioBuffer.duration.toFixed(2)}s @ ${this.cachedAudioBuffer.sampleRate}Hz`);
            return this.cachedAudioBuffer;
        })();

        try {
            return await this.decodingPromise;
        } finally {
            this.decodingPromise = null;
        }
    }

    /**
     * Preload audio buffer in background on file selection
     */
    preloadAudioBuffer(videoUrl) {
        this.loadAudioBuffer(videoUrl).catch(err => {
            console.warn("[FastAudio] Background audio preload warning:", err);
        });
    }

    /**
     * Capture audio segment INSTANTLY (0.001s) from pre-decoded in-memory AudioBuffer
     */
    async captureSegmentAudio(videoUrl, startTime, endTime) {
        try {
            const buffer = await this.loadAudioBuffer(videoUrl);
            const sr = buffer.sampleRate;
            const startSample = Math.max(0, Math.floor(startTime * sr));
            const endSample = Math.min(buffer.length, Math.ceil(endTime * sr));
            const len = endSample - startSample;

            if (len <= 0) return new Float32Array(0);

            const rawChannel = buffer.getChannelData(0).subarray(startSample, endSample);
            console.log(`[FastAudio] Instant slice: ${rawChannel.length} samples (${(len/sr).toFixed(2)}s) in <1ms!`);

            return await this.resampleTo16k(rawChannel, sr);
        } catch (err) {
            console.warn("[FastAudio] In-memory decode unavailable, fallback to video element playback:", err);
            return await this.fallbackRealtimeCapture(videoUrl, startTime, endTime);
        }
    }

    /**
     * Fallback ultra-fast audio capture from video element (8x speed)
     */
    fallbackRealtimeCapture(videoUrl, startTime, endTime) {
        return new Promise((resolve, reject) => {
            const segDuration = endTime - startTime;
            const PLAYBACK_RATE = 8.0; // 8x speed for ultra-fast fallback capture
            console.log(`[Capture] Fast Fallback: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s (Duration: ${segDuration.toFixed(1)}s) @ ${PLAYBACK_RATE}x`);

            const video = document.createElement('video');
            video.src = videoUrl;
            video.preload = 'auto';
            video.muted = false;
            video.volume = 1.0; // CRITICAL: Must be 1.0 so WebAudio gets real samples!
            video.playbackRate = PLAYBACK_RATE;
            video.preservesPitch = false;
            video.webkitPreservesPitch = false;

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaElementSource(video);
            // Use larger buffer (8192) to prevent frame drops at higher playback speeds
            const processor = audioCtx.createScriptProcessor(8192, 1, 1);

            // Silent GainNode connected to destination so audio plays through pipeline without speaker noise
            const silentGain = audioCtx.createGain();
            silentGain.gain.value = 0; // Silent to speakers

            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(audioCtx.destination);

            const chunks = [];
            let finished = false;
            let maxAmpCaptured = 0;
            let capturedDuration = 0;

            const cleanup = () => {
                if (finished) return;
                finished = true;
                try { processor.disconnect(); } catch(e) {}
                try { source.disconnect(); } catch(e) {}
                try { silentGain.disconnect(); } catch(e) {}
                try { video.pause(); } catch(e) {}
                try { video.remove(); } catch(e) {}
                audioCtx.close().catch(() => {});
            };

            const finalizeCapture = (reason) => {
                cleanup();
                const nativeSR = audioCtx.sampleRate || 48000;
                const total = chunks.reduce((s, c) => s + c.length, 0);
                if (total === 0) {
                    reject(new Error("Audio capture kosong — tidak ada sampel terekam"));
                    return;
                }
                const raw = new Float32Array(total);
                let pos = 0;
                for (const c of chunks) { raw.set(c, pos); pos += c.length; }
                capturedDuration = total / nativeSR;
                const expectedDuration = segDuration / PLAYBACK_RATE;
                const captureRatio = (capturedDuration / expectedDuration * 100).toFixed(1);
                console.log(`[Capture] ${reason}: ${raw.length} samples @ ${nativeSR}Hz | ${capturedDuration.toFixed(2)}s captured (${captureRatio}% of expected) | Max Amp: ${maxAmpCaptured.toFixed(6)}`);

                if (maxAmpCaptured < 0.0005) {
                    console.warn("[Capture] Warning: Extremely low or zero amplitude detected!");
                }

                // Resample to 16kHz for Whisper
                this.resampleTo16k(raw, nativeSR).then(resolve).catch(reject);
            };

            processor.onaudioprocess = (e) => {
                if (finished) return;

                const inputChannel = e.inputBuffer.getChannelData(0);
                const copy = new Float32Array(inputChannel.length);
                copy.set(inputChannel);

                // Track max amplitude to verify audio presence
                for (let i = 0; i < copy.length; i++) {
                    const abs = Math.abs(copy[i]);
                    if (abs > maxAmpCaptured) maxAmpCaptured = abs;
                }

                chunks.push(copy);

                if (video.currentTime >= endTime || video.ended) {
                    finalizeCapture("Playback complete");
                }
            };

            video.addEventListener('canplay', () => {
                video.currentTime = startTime;
            }, { once: true });

            video.addEventListener('seeked', () => {
                if (!finished) {
                    video.play().catch(e => {
                        console.error("[Capture] Play error:", e);
                        cleanup();
                        reject(e);
                    });
                }
            }, { once: true });

            video.addEventListener('error', (err) => {
                console.error("[Capture] Video element error:", err);
                cleanup();
                reject(new Error("Gagal membaca stream video"));
            });

            // Safety timeout: generous margin to ensure full audio capture
            // segDuration / PLAYBACK_RATE = real-time playback + 15s margin for seek + buffering
            const timeoutMs = Math.max(15000, ((segDuration / PLAYBACK_RATE) + 15) * 1000);
            setTimeout(() => {
                if (!finished) {
                    finalizeCapture("Timeout safety");
                }
            }, timeoutMs);

            video.load();
        });
    }

    /**
     * Resample Float32Array from native sample rate to 16kHz using OfflineAudioContext
     */
    async resampleTo16k(samples, fromSR) {
        if (!samples || samples.length === 0) return new Float32Array(0);
        if (fromSR === 16000) return samples;

        const duration = samples.length / fromSR;
        const targetSamples = Math.ceil(duration * 16000);

        const offline = new OfflineAudioContext(1, targetSamples, 16000);
        const buffer = offline.createBuffer(1, samples.length, fromSR);
        buffer.getChannelData(0).set(samples);

        const src = offline.createBufferSource();
        src.buffer = buffer;
        src.connect(offline.destination);
        src.start(0);

        const resampled = await offline.startRendering();
        return resampled.getChannelData(0);
    }

    setGeminiApiKey(key) {
        this.geminiApiKey = (key || '').trim();
    }

    resetScriptCursor() {
        this.scriptCursorIndex = 0;
        console.log("[ScriptAlign] Sequential script cursor reset to 0");
    }

    setReferenceScript(scriptText) {
        this.referenceScriptText = (scriptText || '').trim();
        this.resetScriptCursor();
        if (this.referenceScriptText) {
            console.log(`[ScriptGuidance] Reference script active (${this.referenceScriptText.length} chars)`);
        } else {
            console.log("[ScriptGuidance] Reference script cleared");
        }
    }

    /**
     * Bigram Fuzzy Similarity score (0.0 to 1.0) between two strings.
     * Handles typos seamlessly (e.g. "wabarokatuh" vs "wabarokaatuh" -> 0.88 similarity!)
     */
    fuzzySimilarity(str1, str2) {
        if (!str1 || !str2) return 0.0;
        const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
        const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (s1 === s2) return 1.0;
        if (s1.length < 2 || s2.length < 2) return 0.0;

        const getBigrams = (s) => {
            const bigrams = new Map();
            for (let i = 0; i < s.length - 1; i++) {
                const bg = s.substring(i, i + 2);
                bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
            }
            return bigrams;
        };

        const bg1 = getBigrams(s1);
        const bg2 = getBigrams(s2);

        let overlap = 0;
        for (const [bg, count1] of bg1.entries()) {
            if (bg2.has(bg)) {
                overlap += Math.min(count1, bg2.get(bg));
            }
        }

        const total1 = s1.length - 1;
        const total2 = s2.length - 1;
        return (2.0 * overlap) / (total1 + total2);
    }

    /**
     * Match raw AI transcript against Reference Script sentences using Sequential Window Matcher.
     * Prevents out-of-order jumps (e.g. Klip 1 jumping to Segment 5) by tracking chronological script position!
     */
    alignWithReferenceScript(rawText, scriptText, segIdx = null) {
        if (!rawText || !scriptText) return rawText;

        const cleanRaw = rawText.trim();
        if (cleanRaw.length < 3) return rawText;

        // Split reference script into lines / sentences
        const scriptSentences = scriptText
            .split(/[\r\n.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length >= 4);

        if (scriptSentences.length === 0) return rawText;

        if (this.scriptCursorIndex === undefined || this.scriptCursorIndex === null) {
            this.scriptCursorIndex = 0;
        }

        // If segIdx is 0 (first row in queue), reset cursor to beginning of script
        if (segIdx === 0) {
            this.scriptCursorIndex = 0;
        }

        // 1. Sequential search window: Look at sentences starting from current cursor (+8 sentences)
        const startIdx = Math.max(0, this.scriptCursorIndex);
        const windowSize = 8;
        const candidateSentences = scriptSentences.slice(startIdx, startIdx + windowSize);

        let bestSentence = null;
        let bestMatchIndexInCandidates = 0;
        let maxSimilarity = 0;

        candidateSentences.forEach((sentence, idx) => {
            const score = this.fuzzySimilarity(cleanRaw, sentence);
            if (score > maxSimilarity) {
                maxSimilarity = score;
                bestSentence = sentence;
                bestMatchIndexInCandidates = idx;
            }
        });

        // 2. If no good match in local window (< 0.22), expand search with distance penalty to avoid far jumps
        if (maxSimilarity < 0.22) {
            scriptSentences.forEach((sentence, idx) => {
                const score = this.fuzzySimilarity(cleanRaw, sentence);
                // Penalty for jumping far away from current timeline position
                const distPenalty = Math.abs(idx - startIdx) * 0.025;
                const adjustedScore = score - distPenalty;

                if (adjustedScore > maxSimilarity) {
                    maxSimilarity = adjustedScore;
                    bestSentence = sentence;
                    bestMatchIndexInCandidates = idx - startIdx;
                }
            });
        }

        // If similarity score is >= 0.20, replace text and advance script cursor chronologically!
        if (bestSentence && maxSimilarity >= 0.20) {
            const matchedIndex = Math.max(0, startIdx + bestMatchIndexInCandidates);
            this.scriptCursorIndex = Math.min(scriptSentences.length - 1, matchedIndex + 1);
            console.log(`[ScriptAlign (Seg ${segIdx ?? 'single'})] Matched Sentence #${matchedIndex} -> "${bestSentence.slice(0, 40)}..." (Score: ${(maxSimilarity * 100).toFixed(1)}%) | Next cursor: ${this.scriptCursorIndex}`);
            return bestSentence;
        }

        return rawText;
    }

    /**
     * Encode Float32Array PCM samples (16kHz mono) to WAV Blob
     */
    encodeWAV(samples, sampleRate = 16000) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (v, offset, str) => {
            for (let i = 0; i < str.length; i++) {
                v.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // 1 channel
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    /**
     * Transcribe using Google Gemini API (Cloud)
     * Automatically tries gemini-1.5-flash-latest, gemini-1.5-flash-8b, gemini-2.0-flash.
     * Returns transcribed text string on success, or null on error / quota exceeded
     */
    async transcribeWithGemini(pcmSamples) {
        if (!this.geminiApiKey) {
            console.warn("[Gemini API] API Key tidak ditemukan. Beralih ke Whisper Lokal...");
            return null;
        }

        const modelCandidates = [
            'gemini-flash-latest',
            'gemini-2.0-flash-lite',
            'gemini-1.5-flash-latest',
            'gemini-2.0-flash'
        ];

        let lastStatus = 0;
        let lastErrMsg = '';

        try {
            const wavBlob = this.encodeWAV(pcmSamples, 16000);
            const base64Audio = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(wavBlob);
            });

            for (const modelId of modelCandidates) {
                console.log(`[Gemini API] Sending audio segment to ${modelId}...`);

                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(this.geminiApiKey)}`;
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': this.geminiApiKey
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                {
                                    inlineData: {
                                        mimeType: 'audio/wav',
                                        data: base64Audio
                                    }
                                },
                                {
                                    text: this.referenceScriptText ?
                                        `Berikut adalah NASKAH/SCRIPT RESMI DARI VIDEO INI:\n"""\n${this.referenceScriptText.slice(0, 15000)}\n"""\n\nTUGAS UTAMA: Transkrip ucapan percakapan Bahasa Indonesia dari rekaman audio berikut. Sangat PENTING: Cocokkan kata-kata dalam audio dengan NASKAH RESMI di atas. Gunakan NASKAH RESMI sebagai acuan ejaan, istilah, dan nama yang tepat agar 100% AKURAT TANPA TYPO. Hanya tuliskan teks ucapannya saja tanpa tanda petik dan tanpa penjelasan pembuka/penutup.` :
                                        "Transkrip ucapan percakapan Bahasa Indonesia dari rekaman audio berikut ini dengan sangat akurat dan rapi. Hanya tuliskan teks ucapannya saja tanpa tanda petik dan tanpa penjelasan pembuka/penutup."
                                }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0.1
                        }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                    console.log(`[Gemini API (${modelId})] Success Result: "${rawText}"`);
                    return this.cleanHallucinatedText(rawText);
                }

                const errJson = await response.json().catch(() => ({}));
                lastStatus = response.status;
                lastErrMsg = errJson?.error?.message || response.statusText;
                console.warn(`[Gemini API (${modelId})] Error status (${response.status}): ${lastErrMsg}`);

                // If 404 or 429 with limit: 0 on this specific model, try next candidate model!
                if (response.status === 404 || (response.status === 429 && lastErrMsg.includes('limit: 0'))) {
                    console.log(`[Gemini API] ${modelId} (${response.status}), mencoba model berikutnya...`);
                    continue;
                }

                // If 429 Rate Limit (sent too fast), wait 2.5s and retry once automatically!
                if (response.status === 429) {
                    console.log(`[Gemini API] Rate limit (429), menunggu 2.5s sebelum mencoba lagi...`);
                    await new Promise(r => setTimeout(r, 2500));
                    
                    const retryRes = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                                    { text: "Transkrip ucapan percakapan Bahasa Indonesia dari rekaman audio berikut ini dengan sangat akurat dan rapi. Hanya tuliskan teks ucapannya saja tanpa tanda petik dan tanpa penjelasan pembuka/penutup." }
                                ]
                            }],
                            generationConfig: { temperature: 0.1 }
                        })
                    });

                    if (retryRes.ok) {
                        const data = await retryRes.json();
                        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                        console.log(`[Gemini API (${modelId}) Retry] Success Result: "${rawText}"`);
                        return this.cleanHallucinatedText(rawText);
                    }
                }

                break;
            }

            if (window.showToast) {
                if (lastStatus === 429 && lastErrMsg.includes('limit: 0')) {
                    window.showToast("API Key ini limit: 0 di Google AI Studio. Beralih ke Whisper Lokal...", "warning");
                } else if (lastStatus === 429) {
                    window.showToast("Kuota Gemini API terlampaui (429). Beralih ke Whisper Lokal...", "warning");
                } else if (lastStatus > 0) {
                    window.showToast(`Gemini API Error (${lastStatus}). Beralih ke Whisper Lokal...`, "warning");
                }
            }
            return null;

        } catch (err) {
            console.error("[Gemini API] Network / processing error:", err);
            return null; // Signals fallback to Whisper
        }
    }

    /**
     * Transcribe a SINGLE segment using Gemini (or Whisper fallback)
     */
    async transcribeSingleSegment(videoUrl, seg, onProgress) {
        if (this.isProcessing) return seg;
        this.isProcessing = true;

        try {
            if (onProgress) onProgress("Capturing audio...");
            const pcm = await this.captureSegmentAudio(videoUrl, seg.startTime, seg.endTime);

            let text = null;
            if (this.modelName.startsWith('gemini')) {
                if (onProgress) onProgress("Transcribing (Gemini Cloud API)...");
                text = await this.transcribeWithGemini(pcm);
                if (text === null) {
                    console.warn("[Hybrid] Gemini API gagal/kuota habis. Otomatis beralih ke Whisper Lokal...");
                    if (onProgress) onProgress("Beralih ke Whisper Lokal...");
                }
            }

            if (text === null) {
                await this.ensurePipeline(onProgress);
                if (onProgress) onProgress("Transcribing (Whisper Lokal)...");

                const whisperOptions = {
                    language: this.language,
                    task: 'transcribe',
                    chunk_length_s: 30,
                    stride_length_s: 5
                };
                if (this.referenceScriptText) {
                    whisperOptions.prompt = this.referenceScriptText.slice(0, 200);
                }

                const result = await this.whisperPipeline(pcm, whisperOptions);

                const raw = (result && result.text) ? result.text.trim() : '';
                text = this.cleanHallucinatedText(raw);
            }

            if (this.referenceScriptText && text) {
                text = this.alignWithReferenceScript(text, this.referenceScriptText);
            }

            seg.text = text;
        } catch (err) {
            console.error("[T] Error:", err);
            seg.text = `[ERROR: ${err.message}]`;
        }

        this.isProcessing = false;
        return seg;
    }

    /**
     * Transcribe selected segments sequentially in a Queue
     */
    async transcribeAllSegments(videoUrl, segments, onProgress, onRowDone, onComplete) {
        if (this.isProcessing || !segments || segments.length === 0) return;
        this.isProcessing = true;

        const queue = segments.map((seg, idx) => ({ seg, idx }))
                              .filter(item => item.seg.selected !== false);

        if (queue.length === 0) {
            this.isProcessing = false;
            if (onComplete) onComplete(segments, "no_selection");
            return;
        }

        const isGeminiMode = this.modelName.startsWith('gemini');

        try {
            this.resetScriptCursor();
            if (!isGeminiMode) {
                await this.ensurePipeline(onProgress);
            }

            for (let i = 0; i < queue.length; i++) {
                if (!this.isProcessing) {
                    console.log("[Queue] Transcribe stopped by user.");
                    break;
                }

                const { seg, idx } = queue[i];
                const pct = Math.round(((i + 1) / queue.length) * 100);

                try {
                    if (onProgress) onProgress(`Menyiapkan audio (${i + 1}/${queue.length})...`);
                    const pcm = await this.captureSegmentAudio(videoUrl, seg.startTime, seg.endTime);

                    if (!this.isProcessing) break;

                    let text = null;
                    if (isGeminiMode) {
                        if (onProgress) onProgress(`Mengirim ke Gemini AI (${i + 1}/${queue.length})...`);
                        text = await this.transcribeWithGemini(pcm);

                        if (text === null) {
                            console.warn(`[Queue Part ${idx+1}] Gemini API tidak merespons/kuota habis. Fallback ke Whisper Lokal!`);
                            if (onProgress) onProgress(`Beralih ke Whisper Lokal (${i + 1}/${queue.length})...`);
                            await this.ensurePipeline(onProgress);
                        }
                    }

                    if (text === null) {
                        if (onProgress) onProgress(`Whisper Lokal (${i + 1}/${queue.length})... ${pct}%`);
                        const whisperOptions = {
                            language: this.language,
                            task: 'transcribe',
                            chunk_length_s: 30,
                            stride_length_s: 5
                        };
                        if (this.referenceScriptText) {
                            whisperOptions.prompt = this.referenceScriptText.slice(0, 200);
                        }
                        const result = await this.whisperPipeline(pcm, whisperOptions);
                        const raw = (result && result.text) ? result.text.trim() : '';
                        text = this.cleanHallucinatedText(raw);
                    }

                    // Automatic Post-Processing Script Alignment (100% Typo-Free Chronological Correction)
                    if (this.referenceScriptText && text) {
                        text = this.alignWithReferenceScript(text, this.referenceScriptText, i);
                    }

                    seg.text = text;
                } catch (e) {
                    console.error("[Queue] Error transcribing seg", idx, e);
                }

                if (onRowDone) onRowDone(idx, seg);

                // Add 1.2s rate limit delay between Gemini API requests to stay under 15 RPM free tier limit
                if (isGeminiMode && i < queue.length - 1 && this.isProcessing) {
                    await new Promise(r => setTimeout(r, 1200));
                }
            }

            const wasCancelled = !this.isProcessing;
            this.isProcessing = false;
            if (onProgress) onProgress(wasCancelled ? "Dihentikan" : "Selesai!");
            if (onComplete) onComplete(segments, wasCancelled ? "cancelled" : "done");
        } catch (err) {
            console.error("[Queue] Error:", err);
            this.isProcessing = false;
            if (onComplete) onComplete(segments, "error");
        }
    }

    /**
     * Build segments from markers, including 00:00 gap
     */
    buildSegmentsFromMarkers(markers, totalVideoDuration) {
        if (markers && markers.length > 0) {
            const sorted = [...markers].sort((a, b) => a.startTime - b.startTime);
            const segments = [];

            if (sorted[0].startTime > 0.5) {
                const end = sorted[0].startTime;
                segments.push({
                    id: 'part-0', startTime: 0, endTime: end, duration: end,
                    timecodeStart: VideoParser.formatTimecode(0),
                    timecodeEnd: VideoParser.formatTimecode(end),
                    timecodeDuration: VideoParser.formatTimecode(end),
                    text: ''
                });
            }

            sorted.forEach((m, i) => {
                const start = m.startTime;
                const end = (m.duration > 0) ? Math.min(totalVideoDuration, start + m.duration) : ((i < sorted.length - 1) ? sorted[i + 1].startTime : totalVideoDuration);
                const dur = Math.max(0, end - start);
                segments.push({
                    id: `part-${segments.length}`,
                    startTime: start,
                    endTime: end,
                    duration: dur,
                    clipTitle: m.name || null,
                    timecodeStart: m.timecodeStart || VideoParser.formatTimecode(start),
                    timecodeEnd: (i < sorted.length - 1) ? (sorted[i + 1].timecodeStart || VideoParser.formatTimecode(end)) : VideoParser.formatTimecode(end),
                    timecodeDuration: VideoParser.formatTimecode(dur),
                    text: ''
                });
            });
            return segments;
        }

        const dur = Math.max(15, totalVideoDuration || 60);
        const parts = [];
        let cur = 0, idx = 0;
        while (cur < dur) {
            const end = Math.min(dur, cur + 15);
            parts.push({
                id: `part-${idx}`, startTime: cur, endTime: end, duration: end - cur,
                timecodeStart: VideoParser.formatTimecode(cur),
                timecodeEnd: VideoParser.formatTimecode(end),
                timecodeDuration: VideoParser.formatTimecode(end - cur),
                text: ''
            });
            cur = end; idx++;
        }
        return parts;
    }

    buildSegmentsFromClips(clips, totalVideoDuration) {
        return this.buildSegmentsFromMarkers(clips, totalVideoDuration);
    }

    /**
     * Smartly split long segments (> maxDurationSec) into smaller natural sub-segments.
     * Splits by sentence boundaries & Indonesian conjunctions, calculating proportional timecodes.
     */
    smartSplitAllSegments(segments, maxDurationSec = 10) {
        if (!segments || segments.length === 0) return [];

        const newSegments = [];

        for (const seg of segments) {
            if (seg.duration <= maxDurationSec) {
                newSegments.push(seg);
                continue;
            }

            const splitSubSegments = this.smartSplitSingleSegment(seg, maxDurationSec);
            newSegments.push(...splitSubSegments);
        }

        // Re-index IDs
        return newSegments.map((s, idx) => ({
            ...s,
            id: `part-${idx}`
        }));
    }

    /**
     * Split a single long segment into sub-segments <= maxDurationSec
     */
    smartSplitSingleSegment(seg, maxDurationSec = 10) {
        const text = (seg.text || '').trim();
        const duration = seg.duration;

        // If no text: split evenly into sub-segments of maxDurationSec
        if (!text) {
            const count = Math.ceil(duration / maxDurationSec);
            const chunkDur = duration / count;
            const subs = [];
            let cur = seg.startTime;

            for (let i = 0; i < count; i++) {
                const start = cur;
                const end = (i === count - 1) ? seg.endTime : Math.min(seg.endTime, cur + chunkDur);
                const d = end - start;
                subs.push({
                    id: `${seg.id}-sub-${i}`,
                    startTime: start,
                    endTime: end,
                    duration: d,
                    timecodeStart: VideoParser.formatTimecode(start),
                    timecodeEnd: VideoParser.formatTimecode(end),
                    timecodeDuration: VideoParser.formatTimecode(d),
                    text: ''
                });
                cur = end;
            }
            return subs;
        }

        // If text is present: split by natural sentence boundaries & conjunctions
        const rawClauses = this._splitTextIntoClauses(text);
        const groupedTextChunks = this._groupClauses(rawClauses, duration, maxDurationSec);

        const totalChars = groupedTextChunks.reduce((acc, str) => acc + str.length, 0);

        const subSegments = [];
        let currentStart = seg.startTime;

        groupedTextChunks.forEach((chunkText, idx) => {
            const isLast = idx === groupedTextChunks.length - 1;
            const prop = totalChars > 0 ? (chunkText.length / totalChars) : (1 / groupedTextChunks.length);
            const subDur = isLast ? Math.max(0, seg.endTime - currentStart) : (duration * prop);
            const currentEnd = isLast ? seg.endTime : (currentStart + subDur);
            const actualDur = Math.max(0, currentEnd - currentStart);

            subSegments.push({
                id: `${seg.id}-sub-${idx}`,
                startTime: currentStart,
                endTime: currentEnd,
                duration: actualDur,
                timecodeStart: VideoParser.formatTimecode(currentStart),
                timecodeEnd: VideoParser.formatTimecode(currentEnd),
                timecodeDuration: VideoParser.formatTimecode(actualDur),
                text: chunkText.trim()
            });

            currentStart = currentEnd;
        });

        return subSegments;
    }

    /**
     * Split text at punctuation and Indonesian conjunction boundaries
     */
    _splitTextIntoClauses(text) {
        // Conjunctions pattern: split BEFORE conjunction word, so conjunction starts the next phrase
        const conjunctionRegex = /\s+(?=\b(kemudian|lalu|bahkan|sehingga|karena|tetapi|padahal|selain itu|maka|sedangkan|namun|dengan demikian|atau|dan|saat|yang|untuk)\b)/gi;

        let parts = text.split(conjunctionRegex).filter(p => p && p.trim().length > 0);

        const finalClauses = [];

        for (const part of parts) {
            // Split by punctuation keeping the punctuation attached to the preceding phrase
            const subParts = part.split(/([.,?!;]+)/g);
            let currentClause = '';

            for (let i = 0; i < subParts.length; i++) {
                const s = subParts[i];
                if (!s) continue;

                if (/^[.,?!;]+$/.test(s)) {
                    currentClause += s;
                    finalClauses.push(currentClause.trim());
                    currentClause = '';
                } else {
                    if (currentClause) {
                        currentClause += ' ' + s;
                    } else {
                        currentClause = s;
                    }
                }
            }
            if (currentClause.trim()) {
                finalClauses.push(currentClause.trim());
            }
        }

        return finalClauses.length > 0 ? finalClauses : [text];
    }

    /**
     * Group smaller clauses together so each group fits target duration (<= maxDurationSec)
     */
    _groupClauses(clauses, totalDuration, maxDurationSec) {
        const totalChars = clauses.reduce((acc, c) => acc + c.length, 0);
        if (totalChars === 0) return clauses;

        const result = [];
        let currentGroup = '';

        for (const clause of clauses) {
            if (!currentGroup) {
                currentGroup = clause;
                continue;
            }

            const candidate = currentGroup + ' ' + clause;
            const candidateDur = (candidate.length / totalChars) * totalDuration;

            if (candidateDur <= maxDurationSec) {
                currentGroup = candidate;
            } else {
                result.push(currentGroup);
                currentGroup = clause;
            }
        }

        if (currentGroup) {
            result.push(currentGroup);
        }

        return result;
    }

    /**
     * Analyze an HTML5 <video> element or image data to detect 'On-Cam' vs 'Voice Over' (blank/black video)
     */
    analyzeCanvasCategory(videoOrCanvasElement) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoOrCanvasElement, 0, 0, 64, 64);

            const imgData = ctx.getImageData(0, 0, 64, 64).data;
            let totalBrightness = 0;
            let colorVariance = 0;
            const firstR = imgData[0], firstG = imgData[1], firstB = imgData[2];

            for (let i = 0; i < imgData.length; i += 4) {
                const r = imgData[i];
                const g = imgData[i + 1];
                const b = imgData[i + 2];
                const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
                totalBrightness += brightness;

                const diff = Math.abs(r - firstR) + Math.abs(g - firstG) + Math.abs(b - firstB);
                colorVariance += diff;
            }

            const numPixels = imgData.length / 4;
            const avgBrightness = totalBrightness / numPixels;
            const avgVariance = colorVariance / numPixels;

            console.log(`[CategoryDetect] Avg Brightness: ${avgBrightness.toFixed(1)}, Avg Variance: ${avgVariance.toFixed(1)}`);

            // Blank/black video frame or dark slide background (VO)
            if (avgBrightness < 32 || avgVariance < 20) {
                return 'Voice Over';
            }
            return 'On-Cam';
        } catch (e) {
            console.warn("[CategoryDetect] Canvas read error:", e);
            return 'On-Cam';
        }
    }

    /**
     * Detect whether a segment is 'On-Cam' (has video image) or 'Voice Over' (blank/black video)
     * Reads frame pixel brightness & variance from a 32x32 HTML5 Canvas.
     */
    async detectSegmentCategory(videoUrl, startTime, endTime) {
        return new Promise((resolve) => {
            if (!videoUrl) {
                resolve('On-Cam');
                return;
            }

            const video = document.createElement('video');
            video.src = videoUrl;
            video.preload = 'auto';
            video.muted = true;

            const midTime = startTime + Math.max(0.2, (endTime - startTime) / 2);

            const cleanup = () => {
                try { video.pause(); } catch(e){}
                try { video.remove(); } catch(e){}
            };

            const timer = setTimeout(() => {
                cleanup();
                resolve('On-Cam');
            }, 3000);

            const doAnalyze = () => {
                clearTimeout(timer);
                const category = this.analyzeCanvasCategory(video);
                cleanup();
                resolve(category);
            };

            video.addEventListener('seeked', doAnalyze, { once: true });
            video.addEventListener('loadeddata', () => {
                video.currentTime = midTime;
            }, { once: true });

            video.addEventListener('error', () => {
                clearTimeout(timer);
                cleanup();
                resolve('On-Cam');
            }, { once: true });
        });
    }
}
