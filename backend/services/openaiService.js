import OpenAI from 'openai';

class OpenAIService {
    /**
     * Analyze story text to extract hook, script, and detect gender
     * @param {string} storyText - The raw story text/transcript
     * @param {string} apiKey - OpenAI API Key
     * @returns {Promise<{hook: string, script: string, gender: 'male'|'female'}>} Analysis result
     */
    async analyzeStory(storyText, apiKey) {
        if (!apiKey) {
            throw new Error('OpenAI API key is required for story analysis');
        }

        const openai = new OpenAI({ apiKey });

        try {
            console.log('[OpenAI] Analyzing story for hook, script, and gender...');

            const completion = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are a story extraction engine.

You may ONLY COPY text from the provided story.
You are NOT allowed to rewrite, rephrase, clean, summarize, or improve wording.

ABSOLUTE RULES
- Copy text EXACTLY as-is.
- Do NOT change wording or punctuation.
- Do NOT paraphrase.
- Do NOT merge or split sentences.
- Do NOT invent or omit words inside extracted text.

TASKS

1) HOOK (Exact prefix only)
- The hook MUST start at the FIRST CHARACTER of the story (character 0).
- The hook MUST be the FIRST consecutive sentences of the story (a true prefix).
- The hook MUST end at a sentence boundary.
- The hook MUST NOT end before the central situation/rule/conflict is explicitly introduced.
- If the hook is not an exact prefix of the story, the output is INVALID.

2) SCRIPT (Exact remainder only)
- The script MUST equal the story text starting immediately AFTER the hook and continuing to the LITERAL END of the provided story text.
- The script must be copied verbatim and uninterrupted.
- Do NOT stop early.
- Do NOT end mid-sentence.
- If hook + script does not exactly reconstruct the provided story text, the output is INVALID.

3) GENDER
- Determine narrator gender from context. If unclear, return "male".

OUTPUT
Return PURE JSON ONLY:
{
  "hook": "...",
  "script": "...",
  "gender": "male" or "female"
}`
                    },
                    {
                        role: "user",
                        content: `Here is the story transcript:\n\n${storyText.substring(0, 5000)}` // Limit text length to avoid token limits
                    }
                ],
                model: "gpt-4-turbo", // Or gpt-4o / gpt-3.5-turbo based on preference/cost
                max_tokens: 4096,
                response_format: { type: "json_object" }
            });

            const content = completion.choices[0].message.content;
            const result = JSON.parse(content);

            console.log(`[OpenAI] Analysis complete. Gender: ${result.gender}, Hook length: ${result.hook.length}`);
            return {
                hook: result.hook || "Wait until you hear this story...",
                script: result.script || storyText.substring(0, 300),
                gender: (result.gender && result.gender.toLowerCase() === 'female') ? 'female' : 'male'
            };

        } catch (error) {
            console.error('[OpenAI] Error analyzing story:', error);
            throw new Error(`OpenAI Analysis Failed: ${error.message}`);
        }
    }
}

export const openaiService = new OpenAIService();
