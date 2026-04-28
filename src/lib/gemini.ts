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
    const randomSeed = Math.random().toString(36).substring(7);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Suggest a very simple, relatable, and easy-to-understand question for a casual debate about the Israel-Palestine conflict suitable for 13-18 year olds. 
      The debate is between someone who is "${opinionA}" and someone who is "${opinionB}".
      MANDATORY: 
      1. Use common language that a 13-year-old would understand.
      2. Focus on peace, coexistence, human stories, or simple "What if" scenarios.
      3. Avoid technical political terms, specific dates before 2000, or legal jargon.
      4. Reference code: ${randomSeed} (ensure this is a unique topic every time).
      Example topics: "How can sports bring people together?", "Why is it important to listen to the other side?", "Can we be friends even if our families disagree?".
      Keep it under 8 words.`,
      config: {
        systemInstruction: "Suggest a single, very simple, and empathy-focused starting point for a conversation between young people. Do not provide background. All topics MUST be within the Israel-Palestine context but oriented towards understanding and bridge-building.",
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Suggestion Error:", error);
    return "Topic suggestion unavailable.";
  }
}
