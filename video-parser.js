/**
 * Universal Video File Metadata, XMP Embedded Markers & MP4/MOV Header Parser Engine
 * Frame-rate aware XMP marker parser (supports Premiere Pro f25, f30, f2997, f24, and timecode formats)
 */

class VideoParser {
    /**
     * Read video metadata, embedded XMP markers, MP4 chapters, and raw MP4/MOV header duration
     * @param {File} file 
     * @returns {Promise<Object>} Metadata, tracks, markers
     */
    static async parse(file) {
        // 1. Read first 25MB chunk for metadata (prevents browser memory limit errors!)
        const scanSize = Math.min(file.size, 25 * 1024 * 1024);
        const fileSlice = file.slice(0, scanSize);

        const fileBuffer = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error("Gagal membaca header file video."));
            r.readAsArrayBuffer(fileSlice);
        });

        // 2. Extract Raw MP4/MOV Duration & Timescale from header atoms (mvhd)
        const rawMeta = this.parseMp4MovHeader(fileBuffer);

        // 3. Try HTML5 Video element for playback & exact duration fallback
        let durationSec = rawMeta.duration > 0 ? rawMeta.duration : 0;
        let width = 1920;
        let height = 1080;
        let canPlayVideo = false;
        let videoUrl = '';

        try {
            videoUrl = URL.createObjectURL(file);
            const html5Meta = await this.tryHtml5Video(videoUrl);
            if (html5Meta.duration > 0) {
                durationSec = html5Meta.duration;
                width = html5Meta.width;
                height = html5Meta.height;
                canPlayVideo = true;
            }
        } catch (e) {
            console.warn("HTML5 Video playback not supported for codec, using MP4 header duration.", e);
        }

        if (durationSec <= 0) {
            durationSec = 1.0;
        }

        // 4. Extract Frame-Rate Aware XMP Markers from header chunk
        const extractedMarkers = this.extractXmpAndChapters(fileBuffer, durationSec);

        return this._buildResult(extractedMarkers, durationSec, width, height, videoUrl, canPlayVideo, file.name);
    }

    /**
     * Parse from an already-read ArrayBuffer + pre-created blob URL
     * Used when File object may expire (OneDrive, cloud storage)
     */
    static async parseFromBuffer(arrayBuffer, fileName, blobUrl) {
        // Use first 25MB of the buffer for metadata scan
        const scanSize = Math.min(arrayBuffer.byteLength, 25 * 1024 * 1024);
        const fileBuffer = arrayBuffer.slice(0, scanSize);

        // Extract duration from MP4/MOV header
        const rawMeta = this.parseMp4MovHeader(fileBuffer);
        let durationSec = rawMeta.duration > 0 ? rawMeta.duration : 0;
        let width = 1920;
        let height = 1080;
        let canPlayVideo = false;

        // Try HTML5 Video for exact duration
        if (blobUrl) {
            try {
                const html5Meta = await this.tryHtml5Video(blobUrl);
                if (html5Meta.duration > 0) {
                    durationSec = html5Meta.duration;
                    width = html5Meta.width;
                    height = html5Meta.height;
                    canPlayVideo = true;
                }
            } catch (e) {
                console.warn("HTML5 Video not supported, using MP4 header duration.", e);
            }
        }

        if (durationSec <= 0) durationSec = 1.0;

        // Extract XMP markers
        const extractedMarkers = this.extractXmpAndChapters(fileBuffer, durationSec);

        return this._buildResult(extractedMarkers, durationSec, width, height, blobUrl || '', canPlayVideo, fileName);
    }

    /**
     * Helper to format seconds into HH:MM:SS:FF (25fps)
     */
    static formatTimecode(seconds) {
        if (isNaN(seconds) || seconds < 0) seconds = 0;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const frames = Math.floor((seconds % 1) * 25);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
    }

    /**
     * Shared result builder
     */
    static _buildResult(extractedMarkers, durationSec, width, height, videoUrl, canPlayVideo, fileName) {
        const timecodeDuration = VideoParser.formatTimecode(durationSec);

        const defaultClip = {
            type: 'clip',
            name: fileName.replace(/\.[^/.]+$/, ""),
            startTime: 0,
            endTime: durationSec,
            duration: durationSec,
            timecodeStart: VideoParser.formatTimecode(0),
            timecodeEnd: timecodeDuration,
            timecodeDuration: timecodeDuration,
            track: 'Video 1 (V1)',
            mediaType: 'Video'
        };

        const formattedMarkers = extractedMarkers.map((m, idx) => {
            const mStart = Math.min(durationSec, Math.max(0, m.startTime));
            const mEnd = m.duration > 0 ? Math.min(durationSec, mStart + m.duration) : mStart;
            const mDur = mEnd - mStart;

            return {
                type: 'marker',
                name: m.name || null,
                startTime: mStart,
                endTime: mEnd,
                duration: mDur,
                timecodeStart: VideoParser.formatTimecode(mStart),
                timecodeEnd: VideoParser.formatTimecode(mEnd),
                timecodeDuration: VideoParser.formatTimecode(mDur),
                track: 'Video 1 (V1)',
                mediaType: 'Video'
            };
        });

        const allEntries = [defaultClip, ...formattedMarkers].sort((a, b) => a.startTime - b.startTime);

        const sequence = {
            id: 'seq-video-1',
            name: fileName,
            clips: [defaultClip],
            markers: formattedMarkers,
            allEntries: allEntries,
            totalClips: 1,
            totalMarkers: formattedMarkers.length,
            totalDuration: durationSec,
            formattedTotalDuration: timecodeDuration,
            videoMeta: { width, height, url: canPlayVideo ? videoUrl : '', canPlay: canPlayVideo }
        };

        return {
            isVideo: true,
            videoUrl: canPlayVideo ? videoUrl : '',
            canPlay: canPlayVideo,
            sequences: [sequence],
            totalSequences: 1
        };
    }

    /**
     * Try reading metadata via HTML5 Video element
     */
    static tryHtml5Video(videoUrl) {
        return new Promise((resolve) => {
            const tempVideo = document.createElement('video');
            tempVideo.preload = 'metadata';

            const timer = setTimeout(() => {
                resolve({ duration: 0, width: 0, height: 0 });
            }, 2500);

            tempVideo.onloadedmetadata = () => {
                clearTimeout(timer);
                resolve({
                    duration: tempVideo.duration || 0,
                    width: tempVideo.videoWidth || 1920,
                    height: tempVideo.videoHeight || 1080
                });
            };

            tempVideo.onerror = () => {
                clearTimeout(timer);
                resolve({ duration: 0, width: 0, height: 0 });
            };

            tempVideo.src = videoUrl;
        });
    }

    /**
     * Parse MP4 / MOV Header Atoms (mvhd) directly from ArrayBuffer
     */
    static parseMp4MovHeader(arrayBuffer) {
        try {
            const view = new DataView(arrayBuffer);
            const len = view.byteLength;
            let offset = 0;

            while (offset + 8 < len) {
                const atomSize = view.getUint32(offset);
                const atomType = String.fromCharCode(
                    view.getUint8(offset + 4),
                    view.getUint8(offset + 5),
                    view.getUint8(offset + 6),
                    view.getUint8(offset + 7)
                );

                if (atomType === 'moov' || atomType === 'trak' || atomType === 'mdia') {
                    offset += 8;
                    continue;
                }

                if (atomType === 'mvhd') {
                    const version = view.getUint8(offset + 8);
                    let timescale = 0;
                    let duration = 0;

                    if (version === 1) {
                        timescale = view.getUint32(offset + 8 + 4 + 16);
                        const durHigh = view.getUint32(offset + 8 + 4 + 20);
                        const durLow = view.getUint32(offset + 8 + 4 + 24);
                        duration = (durHigh * 4294967296) + durLow;
                    } else {
                        timescale = view.getUint32(offset + 8 + 4 + 8);
                        duration = view.getUint32(offset + 8 + 4 + 12);
                    }

                    if (timescale > 0 && duration > 0) {
                        return {
                            duration: duration / timescale,
                            timescale: timescale
                        };
                    }
                }

                if (atomSize > 1) {
                    offset += atomSize;
                } else {
                    offset += 8;
                }
            }
        } catch (e) {
            console.warn("MP4/MOV header parse error:", e);
        }

        return { duration: 0, timescale: 0 };
    }

    /**
     * Scan File ArrayBuffer for embedded XMP Metadata & MP4 QuickTime Chapters
     */
    /**
     * Scan File ArrayBuffer for embedded XMP Metadata & MP4 QuickTime Chapters
     * Decodes both Head (0-30MB) and Tail (last 30MB) so XMP at the end of MP4 is never missed!
     */
    static extractXmpAndChapters(arrayBuffer, totalVideoDurationSec = 0) {
        const markers = [];
        try {
            const totalLen = arrayBuffer.byteLength;
            const CHUNK_SIZE = 30 * 1024 * 1024;
            const decoder = new TextDecoder('latin1');
            let textContent = "";

            if (totalLen <= CHUNK_SIZE * 2) {
                textContent = decoder.decode(new Uint8Array(arrayBuffer));
            } else {
                const headText = decoder.decode(new Uint8Array(arrayBuffer, 0, CHUNK_SIZE));
                const tailOffset = totalLen - CHUNK_SIZE;
                const tailText = decoder.decode(new Uint8Array(arrayBuffer, tailOffset, CHUNK_SIZE));
                textContent = headText + "\n" + tailText;
            }

            // 1. Detect Frame Rate in XMP (e.g. f25, f30, f2997, f24)
            let frameRate = 25.0; // Default Premiere frame rate
            const frameRateMatch = textContent.match(/xmpDM:frameRate=["']f?([0-9.]+)/i) ||
                                   textContent.match(/<xmpDM:frameRate>f?([0-9.]+)<\/xmpDM:frameRate>/i);
            
            if (frameRateMatch && frameRateMatch[1]) {
                const parsedFps = parseFloat(frameRateMatch[1]);
                if (parsedFps === 2997) frameRate = 29.97;
                else if (parsedFps === 23976 || parsedFps === 2397) frameRate = 23.976;
                else if (parsedFps > 0 && parsedFps < 1000) frameRate = parsedFps;
            }

            // 2. Helper to extract clean clip/file name from XMP node string
            const extractCleanName = (str) => {
                if (!str) return null;
                const match = str.match(/stRef:filePath=["']([^"']+)["']/i) ||
                              str.match(/<stRef:filePath>([^<]+)<\/stRef:filePath>/i) ||
                              str.match(/xmpDM:name=["']([^"']+)["']/i) || 
                              str.match(/<xmpDM:name>([^<]+)<\/xmpDM:name>/i) ||
                              str.match(/xmpDM:logComment=["']([^"']+)["']/i) ||
                              str.match(/<xmpDM:logComment>([^<]+)<\/xmpDM:logComment>/i) ||
                              str.match(/xmpDM:comment=["']([^"']+)["']/i) ||
                              str.match(/<xmpDM:comment>([^<]+)<\/xmpDM:comment>/i) ||
                              str.match(/<dc:title>([^<]+)<\/dc:title>/i);

                if (!match || !match[1]) return null;
                let val = match[1].trim();
                if (val.includes('/') || val.includes('\\')) {
                    val = val.split(/[/\\]/).pop();
                }
                return val || null;
            };

            // 3. Scan xmpMM:Ingredients (actual source footage clips used on timeline)
            const ingredientsMatch = textContent.match(/<xmpMM:Ingredients>([\s\S]*?)<\/xmpMM:Ingredients>/i);
            if (ingredientsMatch && ingredientsMatch[1]) {
                const liMatches = ingredientsMatch[1].match(/<rdf:li[\s\S]*?(\/>|<\/rdf:li>)/gi);
                if (liMatches) {
                    liMatches.forEach((liStr, idx) => {
                        const clipName = extractCleanName(liStr);
                        const startMatch = liStr.match(/xmpDM:startTime=["']([^"']+)["']/i) || 
                                           liStr.match(/<xmpDM:startTime>([^<]+)<\/xmpDM:startTime>/i) ||
                                           liStr.match(/stRef:fromTime=["']([^"']+)["']/i);
                        const durMatch = liStr.match(/xmpDM:duration=["']([^"']+)["']/i) || 
                                         liStr.match(/<xmpDM:duration>([^<]+)<\/xmpDM:duration>/i);

                        if (startMatch && startMatch[1]) {
                            const startTimeSec = this.parseXmpTimecodeValue(startMatch[1], frameRate, totalVideoDurationSec);
                            const durationSec = durMatch ? this.parseXmpTimecodeValue(durMatch[1], frameRate, totalVideoDurationSec) : 0;
                            if (!isNaN(startTimeSec) && startTimeSec >= 0) {
                                markers.push({
                                    name: clipName || null,
                                    startTime: startTimeSec,
                                    duration: durationSec
                                });
                            }
                        }
                    });
                }
            }

            // 4. Scan XMP Markers & Tracks (<xmpDM:markers> or <xmpDM:Tracks>)
            if (markers.length === 0) {
                const xmpMarkerMatch = textContent.match(/<xmpDM:markers>([\s\S]*?)<\/xmpDM:markers>/i) ||
                                     textContent.match(/<xmpDM:Tracks>([\s\S]*?)<\/xmpDM:Tracks>/i);

                if (xmpMarkerMatch && xmpMarkerMatch[1]) {
                    const xmpContent = xmpMarkerMatch[1];
                    const liMatches = xmpContent.match(/<rdf:li[\s\S]*?(\/>|<\/rdf:li>)/gi);
                    
                    if (liMatches) {
                        liMatches.forEach((liStr, idx) => {
                            const clipName = extractCleanName(liStr);

                            const startMatch = liStr.match(/xmpDM:startTime=["']([^"']+)["']/i) || 
                                               liStr.match(/<xmpDM:startTime>([^<]+)<\/xmpDM:startTime>/i);

                            const durMatch = liStr.match(/xmpDM:duration=["']([^"']+)["']/i) || 
                                             liStr.match(/<xmpDM:duration>([^<]+)<\/xmpDM:duration>/i);

                            if (startMatch && startMatch[1]) {
                                const startTimeSec = this.parseXmpTimecodeValue(startMatch[1], frameRate, totalVideoDurationSec);
                                const durationSec = durMatch ? this.parseXmpTimecodeValue(durMatch[1], frameRate, totalVideoDurationSec) : 0;

                                if (!isNaN(startTimeSec) && startTimeSec >= 0) {
                                    markers.push({
                                        name: clipName || null,
                                        startTime: startTimeSec,
                                        duration: durationSec
                                    });
                                }
                            }
                        });
                    }
                }
            }

            // 3. Scan QuickTime Chapter Atom (chpl) if XMP markers not found
            if (markers.length === 0) {
                const chplIndex = textContent.indexOf('chpl');
                if (chplIndex !== -1) {
                    let offset = chplIndex + 4;
                    if (offset + 4 < view.length) {
                        const chapterCount = view[offset + 4];
                        offset += 5;
                        for (let c = 0; c < chapterCount && offset < view.length; c++) {
                            offset += 8;
                            const strLen = view[offset];
                            offset += 1;
                            if (offset + strLen <= view.length) {
                                const titleBytes = view.subarray(offset, offset + strLen);
                                const title = new TextDecoder('utf-8').decode(titleBytes);
                                markers.push({ name: title, startTime: c * 15, duration: 0 });
                                offset += strLen;
                            }
                        }
                    }
                }
            }

        } catch (e) {
            console.warn("XMP & Chapter extraction exception:", e);
        }

        return markers;
    }

    /**
     * Parse XMP Timecode / Frame value into Seconds using detected FrameRate
     */
    static parseXmpTimecodeValue(rawVal, frameRate = 25.0, totalVideoDurationSec = 0) {
        if (!rawVal) return 0;
        rawVal = String(rawVal).trim();

        // 1. Timecode format HH:MM:SS:FF or HH:MM:SS.MS
        if (rawVal.includes(':')) {
            const parts = rawVal.split(/[:.]/);
            if (parts.length >= 3) {
                const h = parseFloat(parts[0]) || 0;
                const m = parseFloat(parts[1]) || 0;
                const s = parseFloat(parts[2]) || 0;
                const f = parts.length > 3 ? parseFloat(parts[3]) || 0 : 0;
                return (h * 3600) + (m * 60) + s + (f / frameRate);
            }
        }

        // 2. Explicit frames e.g. "125f"
        if (rawVal.endsWith('f')) {
            const frames = parseFloat(rawVal);
            return frames / frameRate;
        }

        // 3. Audio samples e.g. "44100s"
        if (rawVal.endsWith('s')) {
            const samples = parseFloat(rawVal);
            return samples / 44100.0;
        }

        // 4. Raw numeric value (can be frames OR seconds OR ticks!)
        const numericVal = parseFloat(rawVal);
        if (isNaN(numericVal)) return 0;

        // Check if value is Premiere Ticks (254,016,000,000 / sec)
        if (numericVal > 100000000) {
            return numericVal / 254016000000.0;
        }

        // Check if numericVal is frames (e.g. 500 frames at 25fps = 20.0s)
        if (totalVideoDurationSec > 0) {
            if (numericVal > totalVideoDurationSec) {
                const calcSec = numericVal / frameRate;
                if (calcSec <= totalVideoDurationSec) {
                    return calcSec;
                }
            }
        }

        return numericVal;
    }
}
