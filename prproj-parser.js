/**
 * Premiere Pro (.prproj) GZIP & XML Parser Engine
 * Advanced Multi-Tiered Parser with Deep Object Graph Resolution
 * Standard Premiere Ticks per second: 254,016,000,000
 */

const PREMIERE_TICKS_PER_SECOND = 254016000000.0;

class PrprojParser {
    /**
     * Parse a .prproj File or ArrayBuffer
     * @param {ArrayBuffer} buffer 
     * @returns {Promise<Object>} Object containing file info, sequences, tracks, clips, and markers
     */
    static async parse(buffer) {
        // 1. Decompress GZIP XML
        const xmlText = await this.decompress(buffer);
        
        // 2. Parse XML Document
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            throw new Error("Gagal membaca struktur XML file project Premiere Pro.");
        }

        // 3. Build Global Object Reference Map for names, titles, and media paths
        const objectMap = this.buildObjectMap(xmlDoc);

        // 4. Extract Sequences
        let sequences = this.extractSequences(xmlDoc, objectMap);

        // 5. Fallback: If no sequences or clips found, perform deep item scanning
        if (sequences.length === 0 || sequences.every(s => s.allEntries.length === 0)) {
            const fallbackSeq = this.deepScanFallback(xmlDoc, objectMap);
            if (fallbackSeq && fallbackSeq.allEntries.length > 0) {
                sequences = [fallbackSeq];
            }
        }

        return {
            isPrproj: true,
            sequences: sequences,
            totalSequences: sequences.length
        };
    }

    /**
     * Decompress GZIP buffer using native DecompressionStream API
     */
    static async decompress(arrayBuffer) {
        try {
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array(arrayBuffer));
                    controller.close();
                }
            }).pipeThrough(new DecompressionStream('gzip'));

            const response = new Response(stream);
            return await response.text();
        } catch (e) {
            console.warn("GZIP decompression failed or file is plain XML. Trying text decode directly.", e);
            const decoder = new TextDecoder('utf-8');
            return decoder.decode(arrayBuffer);
        }
    }

    /**
     * Ticks to Seconds conversion
     */
    static ticksToSeconds(ticks) {
        if (ticks === null || ticks === undefined) return 0;
        const val = parseFloat(ticks);
        if (isNaN(val)) return 0;
        return val / PREMIERE_TICKS_PER_SECOND;
    }

    /**
     * Seconds to Timecode format (HH:MM:SS or MM:SS)
     */
    static formatTimecode(seconds) {
        if (isNaN(seconds) || seconds < 0) seconds = 0;
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const pad = (num) => String(num).padStart(2, '0');

        if (hrs > 0) {
            return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
        } else {
            return `${pad(mins)}:${pad(secs)}`;
        }
    }

    /**
     * Build a dictionary mapping all ObjectIDs in XML to their resolves names/titles/filepaths
     */
    static buildObjectMap(xmlDoc) {
        const map = new Map();
        const allElements = xmlDoc.getElementsByTagName("*");

        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const objectId = el.getAttribute("ObjectID") || el.getAttribute("ObjectRef");
            
            if (objectId && !map.has(objectId)) {
                let foundName = "";

                // Look for child Name, Title, RelativePath, or FileName
                const nameNode = el.getElementsByTagName("Name")[0];
                const titleNode = el.getElementsByTagName("Title")[0];
                const pathNode = el.getElementsByTagName("RelativePath")[0] || el.getElementsByTagName("FilePath")[0];
                const clipNameNode = el.getElementsByTagName("ClipName")[0];

                if (nameNode && nameNode.textContent.trim()) {
                    foundName = nameNode.textContent.trim();
                } else if (titleNode && titleNode.textContent.trim()) {
                    foundName = titleNode.textContent.trim();
                } else if (clipNameNode && clipNameNode.textContent.trim()) {
                    foundName = clipNameNode.textContent.trim();
                } else if (pathNode && pathNode.textContent.trim()) {
                    const fullPath = pathNode.textContent.trim();
                    foundName = fullPath.split(/[/\\]/).pop();
                }

                if (foundName) {
                    map.set(objectId, foundName);
                }
            }
        }
        return map;
    }

    /**
     * Extract Sequences, Tracks (V1, V2, A1, A2), Track Items, and Markers
     */
    static extractSequences(xmlDoc, objectMap) {
        const sequenceNodes = Array.from(xmlDoc.getElementsByTagName("Sequence"));
        const results = [];

        sequenceNodes.forEach((seqNode, seqIdx) => {
            const seqNameNode = seqNode.getElementsByTagName("Name")[0];
            const seqName = seqNameNode ? seqNameNode.textContent.trim() : `Sequence ${seqIdx + 1}`;
            
            const clips = [];
            const markers = [];

            // 1. Process Video Tracks
            const videoTrackGroup = seqNode.getElementsByTagName("VideoTrackGroup")[0] || seqNode;
            const videoTracks = Array.from(videoTrackGroup.getElementsByTagName("Track"));
            videoTracks.forEach((trackNode, vIdx) => {
                const trackLabel = `Video ${vIdx + 1} (V${vIdx + 1})`;
                this.parseTrackItems(trackNode, trackLabel, 'Video', objectMap, clips);
            });

            // 2. Process Audio Tracks
            const audioTrackGroup = seqNode.getElementsByTagName("AudioTrackGroup")[0] || seqNode;
            const audioTracks = Array.from(audioTrackGroup.getElementsByTagName("Track"));
            audioTracks.forEach((trackNode, aIdx) => {
                const trackLabel = `Audio ${aIdx + 1} (A${aIdx + 1})`;
                this.parseTrackItems(trackNode, trackLabel, 'Audio', objectMap, clips);
            });

            // 3. Fallback: Generic Tracks if VideoTrackGroup/AudioTrackGroup wasn't separated
            if (videoTracks.length === 0 && audioTracks.length === 0) {
                const genericTracks = Array.from(seqNode.getElementsByTagName("Track"));
                genericTracks.forEach((trackNode, tIdx) => {
                    const mediaType = trackNode.getElementsByTagName("MediaType")[0]?.textContent || "Track";
                    const trackLabel = `${mediaType} ${tIdx + 1}`;
                    this.parseTrackItems(trackNode, trackLabel, mediaType, objectMap, clips);
                });
            }

            // 4. Extract Sequence Markers
            const markerNodes = Array.from(seqNode.getElementsByTagName("Marker"));
            markerNodes.forEach((mNode) => {
                const nameNode = mNode.getElementsByTagName("Name")[0];
                const commentNode = mNode.getElementsByTagName("Comment")[0];
                const inPointNode = mNode.getElementsByTagName("InPoint")[0];
                const outPointNode = mNode.getElementsByTagName("OutPoint")[0];

                if (inPointNode) {
                    const startSec = this.ticksToSeconds(inPointNode.textContent);
                    const endSec = outPointNode ? this.ticksToSeconds(outPointNode.textContent) : startSec;
                    const durationSec = Math.max(0, endSec - startSec);
                    
                    const markerName = (nameNode && nameNode.textContent.trim()) ? nameNode.textContent.trim() : 
                                      (commentNode && commentNode.textContent.trim()) ? commentNode.textContent.trim() : "Marker";

                    markers.push({
                        type: 'marker',
                        name: `[Marker] ${markerName}`,
                        startTime: startSec,
                        endTime: endSec,
                        duration: durationSec,
                        timecodeStart: this.formatTimecode(startSec),
                        timecodeEnd: this.formatTimecode(endSec),
                        timecodeDuration: this.formatTimecode(durationSec),
                        track: 'Sequence Markers'
                    });
                }
            });

            // Combine and sort chronologically by startTime
            const combinedList = [...clips, ...markers].sort((a, b) => a.startTime - b.startTime);
            const maxDuration = combinedList.reduce((max, item) => Math.max(max, item.endTime), 0);

            results.push({
                id: `seq-${seqIdx}`,
                name: seqName,
                clips: clips.sort((a, b) => a.startTime - b.startTime),
                markers: markers.sort((a, b) => a.startTime - b.startTime),
                allEntries: combinedList,
                totalClips: clips.length,
                totalMarkers: markers.length,
                totalDuration: maxDuration,
                formattedTotalDuration: this.formatTimecode(maxDuration)
            });
        });

        return results;
    }

    /**
     * Helper to parse Track Items (ClipTrackItem, VideoClipTrackItem, AudioClipTrackItem, etc.)
     */
    static parseTrackItems(trackNode, trackLabel, mediaType, objectMap, clipsArray) {
        // Collect all possible clip items in track
        const clipItems = Array.from(trackNode.querySelectorAll("ClipTrackItem, VideoClipTrackItem, AudioClipTrackItem, TrackItem, Clip"));

        clipItems.forEach(item => {
            const startNode = item.getElementsByTagName("Start")[0] || item.getElementsByTagName("In")[0];
            const endNode = item.getElementsByTagName("End")[0] || item.getElementsByTagName("Out")[0];

            if (startNode && endNode) {
                const startSec = this.ticksToSeconds(startNode.textContent);
                const endSec = this.ticksToSeconds(endNode.textContent);
                const durationSec = Math.max(0, endSec - startSec);

                // If duration is 0 or negative, skip invalid items
                if (endSec <= startSec) return;

                // Resolve Clip Name
                let clipName = this.resolveClipName(item, objectMap);

                clipsArray.push({
                    type: 'clip',
                    name: clipName,
                    startTime: startSec,
                    endTime: endSec,
                    duration: durationSec,
                    timecodeStart: this.formatTimecode(startSec),
                    timecodeEnd: this.formatTimecode(endSec),
                    timecodeDuration: this.formatTimecode(durationSec),
                    track: trackLabel,
                    mediaType: mediaType
                });
            }
        });
    }

    /**
     * Resolve clip name from element or object reference map
     */
    static resolveClipName(item, objectMap) {
        // 1. Direct Name child
        const directNameNode = item.getElementsByTagName("Name")[0];
        if (directNameNode && directNameNode.textContent.trim()) {
            return directNameNode.textContent.trim();
        }

        // 2. SubClip / MasterClip / ProjectItem ObjectRef references
        const refs = Array.from(item.querySelectorAll("[ObjectRef], [ObjectURIRef]"));
        for (const refNode of refs) {
            const refId = refNode.getAttribute("ObjectRef") || refNode.getAttribute("ObjectURIRef");
            if (refId && objectMap.has(refId)) {
                return objectMap.get(refId);
            }
        }

        // 3. MediaSource / FilePath
        const pathNode = item.getElementsByTagName("RelativePath")[0] || item.getElementsByTagName("FilePath")[0];
        if (pathNode && pathNode.textContent.trim()) {
            return pathNode.textContent.trim().split(/[/\\]/).pop();
        }

        // 4. Component / Title
        const titleNode = item.getElementsByTagName("Title")[0] || item.getElementsByTagName("ClipName")[0];
        if (titleNode && titleNode.textContent.trim()) {
            return titleNode.textContent.trim();
        }

        return "Clip Video";
    }

    /**
     * Deep Scan Fallback: If standard sequence hierarchy is missing or custom XML layout
     */
    static deepScanFallback(xmlDoc, objectMap) {
        const clips = [];
        const allItems = Array.from(xmlDoc.getElementsByTagName("*"));

        allItems.forEach(el => {
            const tagName = el.tagName;
            if (tagName.includes("Clip") || tagName.includes("TrackItem") || tagName.includes("Item")) {
                const startNode = el.getElementsByTagName("Start")[0];
                const endNode = el.getElementsByTagName("End")[0];

                if (startNode && endNode) {
                    const startSec = this.ticksToSeconds(startNode.textContent);
                    const endSec = this.ticksToSeconds(endNode.textContent);
                    const durationSec = Math.max(0, endSec - startSec);

                    if (endSec > startSec) {
                        const name = this.resolveClipName(el, objectMap);
                        clips.push({
                            type: 'clip',
                            name: name,
                            startTime: startSec,
                            endTime: endSec,
                            duration: durationSec,
                            timecodeStart: this.formatTimecode(startSec),
                            timecodeEnd: this.formatTimecode(endSec),
                            timecodeDuration: this.formatTimecode(durationSec),
                            track: 'Timeline Track 1',
                            mediaType: 'Video'
                        });
                    }
                }
            }
        });

        // Filter duplicates by start time and name
        const uniqueClips = [];
        const seen = new Set();

        clips.forEach(c => {
            const key = `${c.name}-${c.startTime}-${c.endTime}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueClips.push(c);
            }
        });

        const sorted = uniqueClips.sort((a, b) => a.startTime - b.startTime);
        const maxDuration = sorted.reduce((max, item) => Math.max(max, item.endTime), 0);

        return {
            id: 'seq-fallback',
            name: 'Premiere Pro Timeline',
            clips: sorted,
            markers: [],
            allEntries: sorted,
            totalClips: sorted.length,
            totalMarkers: 0,
            totalDuration: maxDuration,
            formattedTotalDuration: this.formatTimecode(maxDuration)
        };
    }
}
