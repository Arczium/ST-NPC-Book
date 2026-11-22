import { MODULE_NAME, settings } from './settings_loader.js';
import { sendAgentRequest } from './connection_manager.js';

const MIN_SCRIBE_MARKDOWN_LENGTH = 20;

export async function runSingleScribeWorker(mode, task, transcript) {
    const npcName = String(task.name).trim();
    const replaceName = (str) => String(str ?? '').replace(/\{\{name\}\}/gi, npcName);

    const instructionPrompt = mode === 'create'
        ? replaceName(settings.prompt_creation)
        : replaceName(settings.prompt_updating);

    const outputTemplate = replaceName(settings.prompt_output_template);

    const userParts = [
        `### Target NPC: ${npcName}`,
        ``,
        `### Required Output Markdown Template:`,
        outputTemplate,
    ];

    if (mode === 'update' && task.existingContent) {
        userParts.push(
            ``,
            `### Current Existing Profile for "${npcName}":`,
            task.existingContent
        );
    }

    userParts.push(
        ``,
        `### New Chat Transcript Slice:`,
        transcript
    );

    const rawMarkdown = await sendAgentRequest({
        profileId: settings.agent_scribe_profile,
        systemPrompt: instructionPrompt,
        userPrompt: userParts.join('\n'),
        maxTokens: Number(settings.agent_scribe_max_token) || 2500,
        temperature: Number(settings.agent_scribe_temperature ?? 0.3),
    });

    const fenceMatch = rawMarkdown.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
    const cleanedMarkdown = (fenceMatch ? fenceMatch[1] : rawMarkdown).trim();

    if (!cleanedMarkdown || cleanedMarkdown.length < MIN_SCRIBE_MARKDOWN_LENGTH) {
        console.warn(`[${MODULE_NAME}] Raw Scribe response for "${npcName}":`, rawMarkdown);
        throw new Error(`Scribe LLM returned an empty or truncated profile for "${npcName}" (${cleanedMarkdown.length} chars).`);
    }

    return cleanedMarkdown;
}

export async function runWithConcurrency(taskFns, concurrency) {
    const maxWorkers = Math.max(1, Number(concurrency) || 3);
    const results = new Array(taskFns.length);
    let nextIdx = 0;

    async function worker() {
        while (nextIdx < taskFns.length) {
            const current = nextIdx++;
            results[current] = await taskFns[current]();
        }
    }

    const workers = Array.from(
        { length: Math.min(maxWorkers, taskFns.length) },
        () => worker()
    );
    await Promise.all(workers);
    return results;
}