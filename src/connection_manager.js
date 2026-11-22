import { generateRaw, substituteParams } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { ConnectionManagerRequestService } from '../../../shared.js';

export function getConnectionProfiles() {
    const profiles = extension_settings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles.map(p => ({
        id: p.id || p.name,
        name: p.name || p.id,
    }));
}

export async function sendAgentRequest({ profileId, systemPrompt, userPrompt, maxTokens, temperature }) {
    const resolvedSystem = substituteParams(systemPrompt);
    const resolvedUser = substituteParams(userPrompt);

    if (profileId && ConnectionManagerRequestService && typeof ConnectionManagerRequestService.sendRequest === 'function') {
        const messages = [
            { role: 'system', content: resolvedSystem },
            { role: 'user', content: resolvedUser },
        ];
        const response = await ConnectionManagerRequestService.sendRequest(
            profileId,
            messages,
            Number(maxTokens) || 1024,
            {
                stream: false,
                extractData: true,
                includePreset: false,
                includeInstruct: false,
            },
            {
                temperature: Number(temperature ?? 0.2),
            }
        );

        if (typeof response === 'string') return response.trim();
        if (response && typeof response.content === 'string') return response.content.trim();
        return String(response ?? '').trim();
    }

    const rawResult = await generateRaw({
        prompt: resolvedUser,
        systemPrompt: resolvedSystem,
        responseLength: Number(maxTokens) || 1024,
    });
    return String(rawResult ?? '').trim();
}