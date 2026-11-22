import { chat, name1 } from '../../../../../script.js';
import { settings } from './settings_loader.js';
import { sendAgentRequest } from './connection_manager.js';

export function buildTranscriptSlice(startIdx, endIdx) {
    if (!Array.isArray(chat) || chat.length === 0) return '';
    const clampedStart = Math.max(0, startIdx);
    const clampedEnd = Math.min(chat.length, endIdx);

    const lines = [];
    for (let i = clampedStart; i < clampedEnd; i++) {
        const msg = chat[i];
        if (!msg || msg.is_system) continue;
        const speaker = msg.name || (msg.is_user ? (name1 || 'User') : 'Character');
        const cleanText = String(msg.mes ?? '').trim();
        if (!cleanText) continue;
        lines.push(`[#${i}] ${speaker}:\n${cleanText}`);
    }

    return lines.join('\n\n---\n\n');
}

export function parseScannerJson(rawText) {
    let cleaned = String(rawText ?? '').trim();
    if (!cleaned) {
        throw new Error('Scanner LLM returned an empty response.');
    }

    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    } else {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.slice(firstBrace, lastBrace + 1);
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        throw new Error(`Scanner LLM returned invalid JSON: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.update) && !Array.isArray(parsed.create))) {
        throw new Error('Scanner JSON is missing required "update" / "create" arrays.');
    }

    return {
        update: Array.isArray(parsed.update) ? parsed.update : [],
        create: Array.isArray(parsed.create) ? parsed.create : [],
    };
}

export async function runScannerStage(transcript, existingNpcs) {
    const trackedRosterJson = JSON.stringify(
        existingNpcs.map(e => ({ uid: e.uid, name: e.name, keys: e.keys })),
        null,
        2
    );

    const userPrompt = [
        `### Already Tracked NPCs (JSON):`,
        trackedRosterJson,
        ``,
        `### Chat Transcript Slice:`,
        transcript,
    ].join('\n');

    const rawResponse = await sendAgentRequest({
        profileId: settings.agent_scanner_profile,
        systemPrompt: settings.prompt_scanning,
        userPrompt,
        maxTokens: Number(settings.agent_scanner_max_token) || 1024,
        temperature: Number(settings.agent_scanner_temperature ?? 0.1),
    });

    return parseScannerJson(rawResponse);
}