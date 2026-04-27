import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function verifyClaim(claim: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a neutral fact-checker for a debate about the Israel-Palestine conflict. 
      Verify the following claim. Provide an extremely short, one-sentence verdict. 
      Start with "Correct:", "Incorrect:", or "Disputed:" followed by the summary.
      
      Claim: "${claim}"`,
      config: {
        systemInstruction: "Provide the most concise, neutral, and factual verification possible. Max 20 words.",
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Verification unavailable at the moment.";
  }
}

export async function generateTopicSuggestion(opinionA: string, opinionB: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Suggest a unique, specific, and controversial sub-topic or question for a debate specifically about the Israel-Palestine conflict. 
      The debate is between someone who is "${opinionA}" and someone who is "${opinionB}".
      MANDATORY: Every suggestion MUST be directly and explicitly related to the history, politics, or ethics of the Israel-Palestine conflict.
      Ensure the topic is different from common superficial questions like "who is right" or "two state solution". 
      Focus on niche historical events, specific policy impacts (e.g., Water rights, the 1948 borders, specific UN resolutions), or distinct ethical dilemmas.
      Avoid repetition and keep it under 15 words.`,
      config: {
        systemInstruction: "Suggest a single, provocative, and neutral starting point for a discussion. Do not provide background, just the question. Prioritize depth and novelty. All topics MUST be within the Israel-Palestine context.",
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Suggestion Error:", error);
    return "Topic suggestion unavailable.";
  }
}
